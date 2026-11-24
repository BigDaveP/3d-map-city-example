"use client";
/**
 * Mode HTML-in-Canvas, option A : les panneaux sont de vrais éléments HTML montés DANS le canvas
 * de MapLibre (portail React, après hydratation), capturés au handler `paint` et dessinés par une
 * custom layer qui partage la profondeur des bâtiments.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "zustand";
import { COURIERS, RESTAURANTS } from "@/lib/carte/catalog";
import { detectApi } from "../hic/detect";
import type { Metrics } from "../metrics";
import { PanelLayer, type PanelGpu } from "./hic/panelLayer";
import { CourierPanel, PANEL_SIZE, RestaurantPanel } from "./Panels";
import { carteStore, couriers, statusChangedAt } from "./store";

type ML = typeof import("maplibre-gl");
type AnyCanvas = HTMLCanvasElement & {
  requestPaint?: () => void;
  updateElementGeometry?: (el: Element, o: { canvasTransform: DOMMatrix }) => void;
};
type AnyGL = WebGL2RenderingContext & { texElementSubImage2D?: (t: number, l: number, x: number, y: number, el: Element) => void };

const PAINT_TIMEOUT_MS = 2500;
const VERIFY_FIRST = 3;
const VERIFY_EVERY = 100;
const MAX_UPLOADS_PER_PAINT = 8;
/** distance (px) et âge (ms) au-delà desquels un verdict d'occlusion sous le curseur n'est plus fiable */
const VERDICT_PX = 6;
const VERDICT_MS = 400;

const keyOf = (kind: "r" | "c", idx: number) => `${kind}${idx}`;

export function HicPanels({ ml, map, metrics, onFallback }: { ml: ML; map: MlMap; metrics: Metrics; onFallback(reason: string): void }) {
  const canvas = map.getCanvas() as AnyCanvas;
  const s = useStore(carteStore);
  const keys = useMemo(
    () => [
      ...s.openRestaurants.filter((i) => RESTAURANTS[i].city === s.city).map((i) => keyOf("r", i)),
      ...s.openCouriers.filter((i) => COURIERS[i].city === s.city).map((i) => keyOf("c", i)),
    ],
    [s.openRestaurants, s.openCouriers, s.city],
  );
  const [ready, setReady] = useState(false);
  const layerRef = useRef<PanelLayer | null>(null);
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;

  // --- couche, paint, garde-fous
  useEffect(() => {
    const api = detectApi();
    if (!api.present || !canvas.updateElementGeometry) {
      fallbackRef.current(`API HTML-in-Canvas absente (${api.detail})`);
      return;
    }
    canvas.setAttribute("content", "drawable");
    canvas.setAttribute("layoutsubtree", "");
    const gl = map.painter.context.gl as AnyGL;
    let disposed = false;
    let uploads = 0;
    let verified = 0;
    let paintSeen = false;
    const requestedAt = performance.now();
    const fail = (reason: string) => {
      if (disposed) return;
      disposed = true;
      fallbackRef.current(reason);
    };
    const layer = new PanelLayer(ml, {
      anchor: (key) => {
        const idx = Number(key.slice(1));
        if (key[0] === "r") {
          const r = RESTAURANTS[idx];
          return { lng: r.lng, lat: r.lat, lift: 30, facade: r.facade };
        }
        if (!couriers.known[idx]) return null;
        const [lng, lat] = couriers.position(idx, performance.now());
        return { lng, lat, lift: 14, facade: couriers.heading[idx] - 90 };
      },
      orientation: () => carteStore.getState().orientation,
      effects: () => {
        const st = carteStore.getState();
        return { fog: st.fog, shadow: st.shadow, transition: st.transition };
      },
      focused: () => {
        const a = document.activeElement;
        return a && canvas.contains(a) ? (a.closest<HTMLElement>("[data-panel]")?.dataset.panel ?? null) : null;
      },
      setGeometry: (el, m) => canvas.updateElementGeometry!(el, { canvasTransform: m }),
      onRender: (ms, lat) => {
        metrics.addWork(ms);
        for (const l of lat) metrics.latency(l);
      },
    });
    layerRef.current = layer;
    map.addLayer(layer);

    // Upload dans le handler paint uniquement (sinon : ancien rendu ou exception).
    const onPaint = (e: Event) => {
      if (disposed) return;
      const t0 = performance.now();
      paintSeen = true;
      const changed = new Set<string>();
      const ce = (e as Event & { changedElements?: ArrayLike<Element> }).changedElements;
      if (ce) for (let i = 0; i < ce.length; i++) {
        const k = (ce[i] as HTMLElement).dataset?.panel;
        if (k) changed.add(k);
      }
      // texture manquante ou contenu changé ; le panneau focalisé d'abord
      const focusedKey = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>("[data-panel]")?.dataset.panel;
      const todo = [...layer.panels.values()].filter((p) => p.el && (!p.tex || changed.has(p.key)));
      todo.sort((a, b) => (a.key === focusedKey ? -1 : b.key === focusedKey ? 1 : 0));
      if (!todo.length) return;
      // l'état GL est suivi par MapLibre : on le restaure après nos uploads
      const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const prevUnit = gl.getParameter(gl.ACTIVE_TEXTURE);
      const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.activeTexture(gl.TEXTURE0);
      const scale = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
      let n = 0;
      for (const p of todo) {
        if (n >= MAX_UPLOADS_PER_PAINT && p.key !== focusedKey) break;
        const el = p.el!;
        // taille en pixels du backing store (une texture trop petite reste noire sans exception)
        const w = Math.max(1, Math.ceil((el.offsetWidth || p.w) * scale));
        const h = Math.max(1, Math.ceil((el.offsetHeight || p.h) * scale));
        if (!p.tex || p.tw < w || p.th < h) {
          if (p.tex) gl.deleteTexture(p.tex);
          p.tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, p.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          p.tw = w;
          p.th = h;
          p.openedAt = performance.now();
        }
        gl.bindTexture(gl.TEXTURE_2D, p.tex);
        const tu = performance.now();
        try {
          gl.texElementSubImage2D!(gl.TEXTURE_2D, 0, 0, 0, el);
        } catch (err) {
          fail(`upload impossible (${(err as Error).message})`);
          break;
        }
        metrics.capture(performance.now() - tu);
        uploads++;
        n++;
        if (verified < VERIFY_FIRST || uploads % VERIFY_EVERY === 0) {
          verified++;
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.tex, 0);
          const px = new Uint8Array(4);
          gl.readPixels(Math.floor(w / 2), Math.floor(h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          gl.deleteFramebuffer(fb);
          gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
          if (px[3] === 0 && px[0] + px[1] + px[2] === 0) {
            fail(`texture vide après upload (readPixels = ${Array.from(px)}) : l'API est détectée mais ne transmet aucun pixel`);
            break;
          }
          if (carteStore.getState().api !== "active") carteStore.setState({ api: "active" });
        }
        // latence statut -> pixel : émise au prochain dessin de ce panneau
        if (p.key[0] === "r") {
          const at = statusChangedAt[Number(p.key.slice(1))];
          if (at && at > (lastLatencyMark.get(p.key) ?? 0)) {
            p.pendingLatency = at;
            lastLatencyMark.set(p.key, at);
          }
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.activeTexture(prevUnit);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      metrics.gpuBytes = [...layer.panels.values()].reduce((a, p) => a + p.tw * p.th * 4, 0);
      metrics.addWork(performance.now() - t0);
      if (n < todo.length) canvas.requestPaint?.();
      map.triggerRepaint();
    };
    const lastLatencyMark = new Map<string, number>();
    canvas.addEventListener("paint", onPaint);
    canvas.requestPaint?.();
    const watchdog = setTimeout(() => {
      if (!paintSeen) fail(`aucun évènement « paint » reçu en ${PAINT_TIMEOUT_MS / 1000} s (contexte sandboxé ou API inactive)`);
    }, PAINT_TIMEOUT_MS + (performance.now() - requestedAt));
    setReady(true);
    (window as unknown as Record<string, unknown>).__hicMap = { layer, stats: () => ({ uploads, verified }) };
    return () => {
      disposed = true;
      clearTimeout(watchdog);
      canvas.removeEventListener("paint", onPaint);
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      layerRef.current = null;
      canvas.removeAttribute("content");
      canvas.removeAttribute("layoutsubtree");
      metrics.gpuBytes = 0;
      setReady(false);
    };
  }, [ml, map, canvas, metrics]);

  // --- après chaque commit : enregistre les éléments des panneaux montés dans la couche
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const els = new Map<string, HTMLElement>();
    for (const el of Array.from(canvas.children) as HTMLElement[]) if (el.dataset.panel) els.set(el.dataset.panel, el);
    for (const [k, p] of layer.panels) {
      if (!els.has(k)) {
        layer.panels.delete(k);
        const gl = map.painter.context.gl;
        if (p.tex) gl.deleteTexture(p.tex);
      }
    }
    for (const [k, el] of els) {
      const cur = layer.panels.get(k);
      if (cur) cur.el = el;
      else {
        const size = k[0] === "r" ? PANEL_SIZE.restaurant : PANEL_SIZE.courier;
        const p: PanelGpu = { key: k, el, w: size.w, h: size.h, tex: null, tw: 0, th: 0, openedAt: performance.now(), proj: null, model: null, visible: null, query: null, pendingLatency: 0 };
        layer.panels.set(k, p);
      }
    }
    (canvas as AnyCanvas).requestPaint?.();
    map.triggerRepaint();
  }, [keys, ready, canvas, map]);

  // --- évènements : les panneaux ne doivent pas déclencher le pan / zoom de MapLibre
  useEffect(() => {
    const stop = (e: Event) => {
      if ((e.target as Element).closest?.("[data-panel]")) e.stopPropagation();
    };
    const types = ["mousedown", "pointerdown", "touchstart", "dblclick", "click", "keydown", "contextmenu"];
    for (const t of types) canvas.addEventListener(t, stop);
    return () => {
      for (const t of types) canvas.removeEventListener(t, stop);
    };
  }, [canvas]);

  // --- hit testing avec occlusion (pointeur) et focus clavier
  useOcclusionHitTesting(canvas, map, layerRef, metrics);

  if (!ready) return null;
  return createPortal(
    keys.map((k) => (k[0] === "r" ? <RestaurantPanel key={k} idx={Number(k.slice(1))} drawable /> : <CourierPanel key={k} idx={Number(k.slice(1))} drawable />)),
    canvas,
  );
}

/**
 * Le hit testing de l'API suit `canvasTransform` mais ignore la profondeur WebGL : un panneau
 * caché derrière un bâtiment reçoit quand même les clics. Solution :
 *  - à chaque déplacement du pointeur, on cherche le panneau sous le curseur (homographie inverse)
 *    et on lance une requête d'occlusion WebGL limitée à ce pixel (scissor 1×1) ;
 *  - le verdict règle `pointer-events` du panneau : `none` s'il est masqué à cet endroit, le clic
 *    tombe alors sur la carte ;
 *  - au pointerdown, sans verdict récent et proche, l'évènement est bloqué (échec fermé).
 * Focus : un panneau masqué reste dans l'ordre de tabulation (lecteurs d'écran) ; quand il reçoit
 * le focus, la caméra se recentre sur lui et il est dessiné au travers des bâtiments (rayons X).
 */
function useOcclusionHitTesting(canvas: AnyCanvas, map: MlMap, layerRef: React.RefObject<PanelLayer | null>, metrics: Metrics) {
  useEffect(() => {
    let verdict: { key: string; x: number; y: number; at: number; scene: number; visible: boolean } | null = null;
    let inflight = false;
    // un verdict reste valable tant que la scène n'a pas bougé (caméra) ; les panneaux de
    // livreurs bougent seuls : pour eux, on borne aussi l'âge du verdict
    let scene = 0;
    let pointer: { x: number; y: number } | null = null;
    const onCamera = () => {
      scene++;
      if (pointer) {
        const key = panelAt(pointer.x, pointer.y);
        if (key) ask(key, pointer.x, pointer.y);
      }
    };
    const stats = { queries: 0, totalMs: 0, blocked: 0, passThrough: 0 };
    (window as unknown as Record<string, unknown>).__occlusion = stats;

    const panelAt = (x: number, y: number) => {
      const layer = layerRef.current;
      if (!layer) return null;
      let best: { key: string; w: number } | null = null;
      for (const p of layer.panels.values()) {
        if (!p.proj || !p.tex) continue;
        const uv = p.proj.unproject(x, y);
        if (!uv || uv[0] < 0 || uv[1] < 0 || uv[0] > p.w || uv[1] > p.h) continue;
        const w = p.proj.project(uv[0], uv[1])[2];
        if (w > 0 && (!best || w < best.w)) best = { key: p.key, w };
      }
      return best?.key ?? null;
    };
    const setPE = (key: string, visible: boolean) => {
      const p = layerRef.current?.panels.get(key);
      if (p?.el) p.el.style.pointerEvents = visible ? "" : "none";
    };
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const ask = (key: string, x: number, y: number) => {
      const layer = layerRef.current;
      if (!layer || inflight) return;
      inflight = true;
      const issuedScene = scene;
      layer.pixelRequests.push({
        key,
        x,
        y,
        issuedAt: performance.now(),
        resolve: (visible, ms) => {
          inflight = false;
          stats.queries++;
          stats.totalMs += ms;
          verdict = { key, x, y, at: performance.now(), scene: issuedScene, visible };
          setPE(key, visible);
        },
      });
      map.triggerRepaint();
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = local(e);
      pointer = { x, y };
      const key = panelAt(x, y);
      if (!key) return;
      if (verdict && verdict.key === key && Math.hypot(verdict.x - x, verdict.y - y) < VERDICT_PX / 2) return;
      ask(key, x, y);
    };
    const onDown = (e: PointerEvent) => {
      const [x, y] = local(e);
      const key = panelAt(x, y);
      if (!key) return;
      const fresh =
        verdict &&
        verdict.key === key &&
        verdict.scene === scene &&
        Math.hypot(verdict.x - x, verdict.y - y) <= VERDICT_PX &&
        (key[0] === "r" || performance.now() - verdict.at < VERDICT_MS);
      if (fresh && verdict!.visible) return;
      if (fresh && !verdict!.visible) {
        stats.passThrough++;
        return; // pointer-events: none -> l'évènement atteint déjà la carte
      }
      // pas de verdict fiable : on bloque ce clic (échec fermé) et on demande le pixel
      stats.blocked++;
      e.preventDefault();
      e.stopImmediatePropagation();
      ask(key, x, y);
    };
    // focus clavier : recentrer la caméra si le panneau n'est pas visible
    const onFocus = (e: FocusEvent) => {
      const key = (e.target as Element).closest?.<HTMLElement>("[data-panel]")?.dataset.panel;
      if (!key) return;
      const p = layerRef.current?.panels.get(key);
      setPE(key, true);
      if (p && p.visible !== true) {
        const idx = Number(key.slice(1));
        const c = key[0] === "r" ? [RESTAURANTS[idx].lng, RESTAURANTS[idx].lat] : couriers.position(idx, performance.now());
        map.easeTo({ center: c as [number, number], duration: 450 });
      }
      map.triggerRepaint();
    };
    const onBlur = () => map.triggerRepaint();
    map.on("move", onCamera);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onDown, true);
    canvas.addEventListener("focusin", onFocus);
    canvas.addEventListener("focusout", onBlur);
    void metrics;
    return () => {
      map.off("move", onCamera);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onDown, true);
      canvas.removeEventListener("focusin", onFocus);
      canvas.removeEventListener("focusout", onBlur);
    };
  }, [canvas, map, layerRef, metrics]);
}
