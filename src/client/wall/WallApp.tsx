"use client";
/**
 * Application du mur (client uniquement, montée après l'hydratation de la page SSR).
 * Possède : store de données, sources, caméra, métriques, boucle de frame, mode de rendu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { KINDS } from "@/lib/sim/types";
import { getLayout, levelForZoom, type Rect } from "@/lib/world";
import { Camera } from "../camera";
import { detectApi } from "../hic/detect";
import { Metrics } from "../metrics";
import { Sources } from "../sources";
import { createDataStore, useData } from "../store";
import { uiStore, type Mode } from "../ui";
import { CanvasWall } from "./CanvasWall";
import { DomWall } from "./DomWall";
import { FrameLoop } from "./frame";
import { MetricsPanel } from "./MetricsPanel";
import { RegionLabels } from "./RegionLabels";
import { RobotView } from "./RobotView";
import { Toolbar, type ToolbarActions } from "./Toolbar";

const INTERACTIVE = "textarea,select,button,input,a,[contenteditable]";

export default function WallApp({ n, initialMode, onAside }: { n: number; initialMode?: Mode; onAside?: (open: boolean) => void }) {
  const ctx = useMemo(() => {
    const ds = createDataStore(n);
    const metrics = new Metrics();
    const camera = new Camera();
    const loop = new FrameLoop(ds, camera, metrics);
    const sources = new Sources(ds, n);
    return { ds, metrics, camera, loop, sources, layout: getLayout(n) };
  }, [n]);
  const { ds, metrics, camera, loop, sources, layout } = ctx;
  const ui = useStore(uiStore);
  const persistence = useData(ds, (s) => s.persistence);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [asideOpen, setAsideOpen] = useState(true);

  // --- détection de l'API et mode initial
  useEffect(() => {
    const api = detectApi();
    const wanted: Mode = initialMode ?? (api.present ? "canvas" : "dom");
    uiStore.setState({
      api: api.present ? "détectée" : "absente",
      apiDetail: api.detail,
      mode: api.present ? wanted : "dom",
      fallback: api.present ? "" : `Mode DOM activé automatiquement : API HTML-in-Canvas absente (${api.detail}).`,
    });
  }, [initialMode]);

  // --- démarrage des sources et de la boucle
  useEffect(() => {
    const vp = viewportRef.current!;
    camera.setViewport(vp.clientWidth, vp.clientHeight);
    camera.set(camera.fit(layout.bounds));
    loop.start();
    sources.loadPersisted().catch((e) => ds.setPersisted({ persistence: `erreur : ${(e as Error).message}` }));
    sources.start(uiStore.getState().speed);
    const ro = new ResizeObserver(() => camera.setViewport(vp.clientWidth, vp.clientHeight));
    ro.observe(vp);
    const unLevel = loop.add(() => {
      const level = levelForZoom(camera.zoom);
      if (level !== uiStore.getState().level) uiStore.setState({ level });
    });
    return () => {
      unLevel();
      ro.disconnect();
      loop.stop();
      sources.stop();
    };
  }, [ds, camera, loop, sources, layout]);

  // --- interactions : molette = zoom au curseur, glisser = pan, Tab = suit le focus
  useEffect(() => {
    const vp = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      camera.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * 0.0015));
    };
    let drag: { id: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest(INTERACTIVE) || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      vp.setPointerCapture(e.pointerId);
      vp.classList.add("dragging");
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      camera.pan(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) {
        drag = null;
        vp.classList.remove("dragging");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest(INTERACTIVE)) return;
      const step = 120;
      const k: Record<string, () => void> = {
        "+": () => camera.zoomAt(camera.vw / 2, camera.vh / 2, 1.25),
        "=": () => camera.zoomAt(camera.vw / 2, camera.vh / 2, 1.25),
        "-": () => camera.zoomAt(camera.vw / 2, camera.vh / 2, 0.8),
        ArrowLeft: () => camera.pan(step, 0),
        ArrowRight: () => camera.pan(-step, 0),
        ArrowUp: () => camera.pan(0, step),
        ArrowDown: () => camera.pan(0, -step),
      };
      if (k[e.key]) {
        e.preventDefault();
        k[e.key]();
      }
    };
    // un champ de carte reçoit le focus (Tab) hors de la vue : la caméra le suit
    const onFocus = (e: FocusEvent) => {
      const card = (e.target as Element).closest?.("[data-card]");
      if (!card) return;
      const c = Number(card.getAttribute("data-card"));
      const v = camera.view();
      const x = layout.cards[c * 4];
      const y = layout.cards[c * 4 + 1];
      const w = layout.cards[c * 4 + 2];
      const h = layout.cards[c * 4 + 3];
      if (x < v.x || y < v.y || x + w > v.x + v.w || y + h > v.y + v.h) camera.flyTo({ x: x + w / 2, y: y + h / 2 }, 250);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("pointerdown", onDown);
    vp.addEventListener("pointermove", onMove);
    vp.addEventListener("pointerup", onUp);
    vp.addEventListener("pointercancel", onUp);
    vp.addEventListener("keydown", onKey);
    vp.addEventListener("focusin", onFocus);
    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("pointerdown", onDown);
      vp.removeEventListener("pointermove", onMove);
      vp.removeEventListener("pointerup", onUp);
      vp.removeEventListener("pointercancel", onUp);
      vp.removeEventListener("keydown", onKey);
      vp.removeEventListener("focusin", onFocus);
    };
  }, [camera, layout]);

  const fallbackToDom = useCallback((reason: string) => {
    uiStore.setState({ mode: "dom", fallback: `Mode DOM activé automatiquement : ${reason}` });
  }, []);

  const actions: ToolbarActions = useMemo(
    () => ({
      setMode: (mode) => uiStore.setState({ mode, fallback: "" }),
      setSpeed: (speed) => {
        uiStore.setState({ speed });
        sources.start(speed);
      },
      storm: () => void sources.storm(),
      setCount: (v) => {
        const u = new URL(location.href);
        u.searchParams.set("n", String(v));
        location.href = u.toString();
      },
      fitAll: () => void camera.flyTo(camera.fit(layout.bounds), 600),
    }),
    [sources, camera, layout],
  );

  // --- API de pilotage pour le banc Playwright et le débogage
  useEffect(() => {
    const cardRect = (c: number): Rect => ({ x: layout.cards[c * 4], y: layout.cards[c * 4 + 1], w: layout.cards[c * 4 + 2], h: layout.cards[c * 4 + 3] });
    const w = window as unknown as Record<string, unknown>;
    w.__wall = {
      n,
      ds,
      camera,
      metrics,
      layout,
      sources,
      ui: uiStore,
      kinds: KINDS,
      actions,
      cardRect,
      regionRect: (i: number) => layout.regions[i],
      fit: (r: Rect, pad?: number) => camera.fit(r, pad),
      flyTo: (c: { x?: number; y?: number; zoom?: number }, dur = 600) => camera.flyTo(c, dur),
      storm: (seed?: number) => sources.storm(seed),
      beginPhase: (name: string) => metrics.beginPhase(name),
      endPhase: () => metrics.endPhase(),
      snapshot: () => metrics.snapshot(),
    };
    return () => {
      delete w.__wall;
    };
  }, [n, ds, camera, metrics, layout, sources, actions]);

  useEffect(() => {
    onAside?.(asideOpen);
  }, [asideOpen, onAside]);

  return (
    <>
      <Toolbar actions={actions} n={n} persistence={persistence} asideOpen={asideOpen} toggleAside={() => setAsideOpen((v) => !v)} />
      {ui.fallback && (
        <div className="fallback" role="status" data-testid="fallback">
          {ui.fallback}
        </div>
      )}
      <div className="viewport" ref={viewportRef} tabIndex={0} aria-label="Mur de supervision : molette pour zoomer, glisser pour se déplacer" data-mode={ui.mode} data-level={ui.level}>
        {ui.mode === "dom" ? (
          <DomWall ds={ds} camera={camera} loop={loop} metrics={metrics} layout={layout} level={ui.level} />
        ) : (
          <CanvasWall ds={ds} camera={camera} loop={loop} metrics={metrics} layout={layout} level={ui.level} onFallback={fallbackToDom} />
        )}
        <RegionLabels layout={layout} camera={camera} loop={loop} ds={ds} />
        <MetricsPanel metrics={metrics} sources={sources} ds={ds} mode={ui.mode} />
        {ui.robotOpen && <RobotView onClose={() => uiStore.setState({ robotOpen: false })} />}
      </div>
    </>
  );
}
