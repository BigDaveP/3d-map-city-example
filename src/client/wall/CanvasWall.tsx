"use client";
/**
 * Mode HTML-in-Canvas.
 *
 * Source de vérité = le DOM : les cartes visibles (niveaux intermédiaire et rapproché) sont
 * des composants React montés DANS le <canvas content="drawable"> par un portail. Le
 * planificateur choisit, à chaque évènement `paint`, quelles cartes recapturer dans les
 * textures ; WebGL2 dessine tuiles, textures et sparklines. Le niveau éloigné ne monte aucun
 * HTML : 1 000 tuiles instanciées en un seul appel de dessin.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CARD_W, type Level, type WorldLayout } from "@/lib/world";
import type { Camera } from "../camera";
import { DisplayState, WallRenderer } from "../hic/renderer";
import { RecaptureScheduler } from "../hic/scheduler";
import { HicSurface, probeGeometryUnit } from "../hic/surface";
import { AtlasStore, PerCardStore, type TextureStore } from "../hic/textures";
import type { Metrics } from "../hic3d/metrics";
import type { DataStore } from "../store";
import { useStore } from "zustand";
import { cardLevel, togglePin, uiStore } from "../ui";
import { Card } from "./cards/Card";
import { CARD_CSS } from "./cards/zones";
import type { FrameLoop } from "./frame";
import { sameList, visibleCards } from "./visible";

export interface CanvasWallProps {
  ds: DataStore;
  camera: Camera;
  loop: FrameLoop;
  metrics: Metrics;
  layout: WorldLayout;
  level: Level;
  onFallback(reason: string): void;
}

/** Budget mémoire des textures (éviction LRU au-delà). */
export const MAX_TEXTURE_BYTES = 256 * 1024 * 1024;
const PAINT_TIMEOUT_MS = 2500;
const VERIFY_FIRST = 3;
const VERIFY_EVERY = 250;

export function CanvasWall({ ds, camera, loop, metrics, layout, level, onFallback }: CanvasWallProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [mounted, setMounted] = useState<number[]>([]);
  const elements = useRef(new Map<number, HTMLElement>());
  const mountedAt = useRef(new Map<number, number>());
  const geometryDirty = useRef(true);
  const levelRef = useRef(level);
  levelRef.current = level;
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const pinned = useStore(uiStore, (s) => s.pinned);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  // Après chaque commit : table carte -> élément (enfants directs du canvas).
  useLayoutEffect(() => {
    if (!canvas) return;
    const next = new Map<number, HTMLElement>();
    for (const el of Array.from(canvas.children) as HTMLElement[]) {
      const c = el.dataset.card;
      if (c === undefined) continue;
      next.set(Number(c), el);
      if (elements.current.get(Number(c)) !== el) mountedAt.current.set(Number(c), loop.frame);
    }
    elements.current = next;
    geometryDirty.current = true;
  }, [canvas, mounted, level, pinned, loop]);

  useEffect(() => {
    if (!canvas) return;
    let surface: HicSurface;
    try {
      surface = new HicSurface(canvas);
    } catch (e) {
      fallbackRef.current(`contexte WebGL2 impossible (${(e as Error).message})`);
      return;
    }
    if (!surface.api.present) {
      fallbackRef.current(`API HTML-in-Canvas absente (${surface.api.detail})`);
      return;
    }
    const unit = probeGeometryUnit();
    uiStore.setState({ apiDetail: `${surface.api.detail} · canvasTransform en ${unit}` });
    const gl = surface.gl;
    const N = layout.cards.length / 4;
    const live = ds.live;
    const renderer = new WallRenderer(gl, layout);
    const display = new DisplayState(N);
    const scheduler = new RecaptureScheduler();
    const alloc = (w: number, h: number) => surface.allocTexture(w, h);
    // l'ancienne API (texElementImage2D) réalloue la texture entière : pas d'atlas possible
    const atlasPossible = surface.api.upload === "texElementSubImage2D";
    const makeStore = (atlas: boolean): TextureStore => (atlas && atlasPossible ? new AtlasStore(gl, alloc, MAX_TEXTURE_BYTES) : new PerCardStore(gl, alloc, MAX_TEXTURE_BYTES));
    let store = makeStore(uiStore.getState().atlas);
    const unAtlas = uiStore.subscribe((s, p) => {
      if (s.atlas === p.atlas) return;
      store.clear();
      store = makeStore(s.atlas);
      display.reset();
    });

    surface.resize();
    let scale = surface.scale;
    let visible: number[] = [];
    let mountList: number[] = [];
    // instant depuis lequel la carte est visible À UN NIVEAU TEXTE (base de la latence)
    const visibleSince = new Float64Array(N);
    const scratch: number[] = [];
    let lastCam = -1;
    let lastLevel: Level = 0;
    let frame = 0;
    let disposed = false;
    // rendu à la demande : on ne redessine (et ne demande un paint) que si quelque chose change
    let needsDraw = true;
    let fading = false;
    let lastRemaining = 0;
    let lastStatusV = -1;
    let lastSparkV = -1;
    let lastPinned: readonly number[] = [];
    // garde-fous
    let requestedAt = 0;
    let paintSeen = false;
    let uploads = 0;
    let verified = 0;
    let uploadErrors = 0;
    let lastError = "";

    const fail = (reason: string) => {
      if (disposed) return;
      disposed = true;
      fallbackRef.current(reason);
    };

    const levelOf = (c: number) => cardLevel(levelRef.current, pinnedRef.current, c);
    const focusedCard = () => {
      const a = document.activeElement;
      if (!a || !canvas.contains(a)) return -1;
      const c = a.closest<HTMLElement>("[data-card]");
      return c ? Number(c.dataset.card) : -1;
    };

    const geometry = () => {
      // élément (px CSS) -> canvas (px CSS) : unité vérifiée par probeGeometryUnit()
      for (const [c, el] of elements.current) {
        const lvl = Number(el.dataset.level) as 1 | 2;
        const [sx, sy] = camera.worldToScreen(layout.cards[c * 4], layout.cards[c * 4 + 1]);
        const k = camera.zoom * (CARD_W / CARD_CSS[lvl].w);
        surface.setGeometry(el, new DOMMatrix([k, 0, 0, k, sx, sy]));
      }
    };

    // ---------------------------------------------------------------- rAF
    const unFrame = loop.add((now) => {
      if (disposed) return;
      frame++;
      surface.resize();
      if (Math.abs(surface.scale - scale) > 1e-3) {
        // le facteur d'échelle change la taille des captures : on repart de zéro
        scale = surface.scale;
        store.clear();
        display.reset();
      }
      const lvl = levelRef.current;
      if (camera.version !== lastCam) {
        lastCam = camera.version;
        visibleCards(layout, camera.view(0), scratch);
        const prev = new Set(visible);
        for (const c of scratch) if (!prev.has(c)) visibleSince[c] = now;
        visible = scratch.slice();
        geometryDirty.current = true;
        needsDraw = true;
      }
      if (lvl !== lastLevel) {
        if (lastLevel === 0) for (const c of visible) visibleSince[c] = now;
        lastLevel = lvl;
        needsDraw = true;
      }
      if (pinnedRef.current !== lastPinned) {
        lastPinned = pinnedRef.current;
        needsDraw = true;
      }
      if (live.statusVersion !== lastStatusV) {
        lastStatusV = live.statusVersion;
        needsDraw = true;
      }
      if (lvl > 0 && live.sparkVersion !== lastSparkV) {
        lastSparkV = live.sparkVersion;
        needsDraw = true;
      }
      // cartes montées : visibles + 5 % de marge, plus la carte qui a le focus
      const next = lvl > 0 ? visibleCards(layout, camera.view(0.05)) : [];
      const f = focusedCard();
      if (f >= 0 && !next.includes(f)) next.push(f);
      if (!sameList(next, mountList)) {
        mountList = next;
        setMounted(next);
      }
      if (geometryDirty.current) {
        geometryDirty.current = false;
        geometry();
      }
      if (needsDraw || fading || lastRemaining > 0) {
        surface.requestPaint();
        if (!requestedAt) requestedAt = now;
      }
      if (!paintSeen && requestedAt && now - requestedAt > PAINT_TIMEOUT_MS) {
        fail(`aucun évènement « paint » reçu en ${PAINT_TIMEOUT_MS / 1000} s (contexte sandboxé ou API inactive)`);
      }
    });

    // ---------------------------------------------------------------- paint
    const onPaint = (e: Event) => {
      if (disposed) return;
      const t0 = performance.now();
      paintSeen = true;
      const lvl = levelRef.current;
      // 1. dirty flags issus du navigateur (saisie, focus, curseur…), hors simple montage
      const changed = (e as Event & { changedElements?: ArrayLike<Element> }).changedElements;
      if (changed) {
        for (let i = 0; i < changed.length; i++) {
          const el = changed[i] as HTMLElement;
          const c = el.dataset?.card;
          if (c === undefined) continue;
          const card = Number(c);
          if ((mountedAt.current.get(card) ?? -1) >= loop.frame - 1) continue;
          live.markDirty(card, t0);
        }
      }
      // 2. planificateur
      const focused = focusedCard();
      const { maxCaptures, maxMs } = uiStore.getState();
      const els = elements.current;
      const candidates = lvl > 0 ? visible.filter((c) => els.get(c)?.dataset.level === String(levelOf(c))) : [];
      if (focused >= 0 && !candidates.includes(focused) && els.has(focused)) candidates.push(focused);
      const res = scheduler.run({
        levelOf,
        candidates,
        focused,
        maxCaptures,
        maxMs,
        textureVersion: (c, l) => store.get(c, l)?.version ?? -1,
        contentVersion: (c) => live.version[c],
        since: (c) => Math.max(live.dirtySince[c], visibleSince[c]) || t0,
        capture: (c) => {
          const el = els.get(c);
          if (!el) return false;
          const l = Number(el.dataset.level);
          const [w, h] = surface.texelSize(el);
          const slot = store.ensure(c, l, w, h, frame);
          if (!slot) return false;
          const existed = slot.version >= 0;
          const version = live.version[c];
          const tu = performance.now();
          const r = surface.upload(el, slot.tex, slot.x, slot.y);
          const ms = performance.now() - tu;
          if (!r.ok) {
            lastError = r.error ?? "";
            if (++uploadErrors >= 5) fail(`échec répété de l'upload de texture (${lastError})`);
            return false;
          }
          uploadErrors = 0;
          uploads++;
          metrics.capture(ms);
          slot.version = version;
          slot.lastUsed = frame;
          // piège connu : API présente mais aucun pixel transmis => texture vide
          if (verified < VERIFY_FIRST || uploads % VERIFY_EVERY === 0) {
            const v = surface.verify(slot.tex, slot.x, slot.y, slot.w, slot.h);
            verified++;
            if (!v.ok) {
              fail(`texture vide après upload (readPixels = ${JSON.stringify(v.samples[0])}) : l'API est détectée mais ne transmet aucun pixel`);
              return false;
            }
            if (uiStore.getState().api !== "active") uiStore.setState({ api: "active" });
          }
          // latence donnée -> pixel : donnée reçue alors que la carte était déjà affichée
          if (l === levelOf(c) && live.dirtySince[c]) {
            if (existed && visibleSince[c] <= live.dirtySince[c]) metrics.latency(performance.now() - live.dirtySince[c]);
            live.dirtySince[c] = 0;
          }
          return true;
        },
      });
      if (disposed) return;
      lastRemaining = res.remaining;
      metrics.queue = res.remaining;
      metrics.gpuBytes = store.bytes;
      metrics.mounted = els.size;
      // 3. dessin (uniquement si l'image change)
      if (res.captured === 0 && !needsDraw && !fading) {
        loop.addWork(performance.now() - t0);
        return;
      }
      needsDraw = false;
      fading = renderer.draw({
        cam: { x: camera.x, y: camera.y, zoom: camera.zoom, vw: camera.vw, vh: camera.vh },
        width: canvas.width,
        height: canvas.height,
        visible,
        levelOf,
        store,
        display,
        live,
        now: t0,
        frame,
      });
      loop.addWork(performance.now() - t0);
    };
    canvas.addEventListener("paint", onPaint);
    const w = window as unknown as Record<string, unknown>;
    w.__hic = { surface, renderer, get store() { return store; }, display, scheduler, stats: () => ({ uploads, verified, uploadErrors, lastError, drawCalls: renderer.drawCalls, textures: store.count, kind: store.kind }) };

    return () => {
      disposed = true;
      unFrame();
      unAtlas();
      canvas.removeEventListener("paint", onPaint);
      store.clear();
      delete w.__hic;
      metrics.gpuBytes = 0;
      metrics.queue = 0;
    };
  }, [canvas, ds, camera, loop, metrics, layout]);

  return (
    <>
      <canvas ref={setCanvas} className="wall-canvas" data-testid="wall-canvas" aria-label="Cartes du mur (HTML-in-Canvas)" />
      {canvas &&
        level > 0 &&
        createPortal(
          mounted.map((c) => {
            const l = cardLevel(level, pinned, c) as 1 | 2;
            return <Card key={`${c}-${l}`} ds={ds} card={c} level={l} drawable onClose={l === 2 && level === 1 ? () => togglePin(c) : undefined} />;
          }),
          canvas,
        )}
    </>
  );
}
