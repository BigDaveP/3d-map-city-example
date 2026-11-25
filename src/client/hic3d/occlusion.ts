"use client";
/**
 * Hit testing avec occlusion des surfaces HTML-in-Canvas dessinées par `PanelLayer`.
 *
 * Le hit testing de l'API suit `canvasTransform` mais ignore la profondeur WebGL : une surface
 * cachée derrière un bâtiment reçoit quand même les clics. Solution :
 *  - à chaque déplacement du pointeur, on cherche la surface sous le curseur (homographie inverse)
 *    et on lance une requête d'occlusion WebGL limitée à ce pixel (scissor 1×1) ;
 *  - le verdict règle `pointer-events` de la surface : `none` si elle est masquée à cet endroit, le
 *    clic tombe alors sur la carte ;
 *  - au pointerdown, sans verdict récent et proche, l'évènement est bloqué (échec fermé).
 * Focus : une surface masquée reste dans l'ordre de tabulation (lecteurs d'écran) ; quand elle
 * reçoit le focus, la caméra se recentre sur elle et elle est dessinée au travers des bâtiments
 * (rayons X).
 * Statistiques sur `window.__occlusion` : { queries, totalMs, blocked, passThrough }.
 */
import { useEffect, type RefObject } from "react";
import type { Map as MlMap } from "maplibre-gl";
import type { PanelLayer } from "../carte/hic/panelLayer";

/** distance (px) et âge (ms) au-delà desquels un verdict d'occlusion sous le curseur n'est plus fiable */
export const VERDICT_PX = 6;
export const VERDICT_MS = 400;

export interface OcclusionHooks {
  /** la surface bouge seule (ancre mobile) : son verdict expire aussi après VERDICT_MS */
  moving(key: string): boolean;
  /** point [lng, lat] sur lequel recentrer la caméra quand la surface reçoit le focus */
  center(key: string): [number, number] | null;
}

export function useOcclusionHitTesting(canvas: HTMLCanvasElement, map: MlMap, layerRef: RefObject<PanelLayer | null>, hooks: RefObject<OcclusionHooks>) {
  useEffect(() => {
    let verdict: { key: string; x: number; y: number; at: number; scene: number; visible: boolean } | null = null;
    let inflight = false;
    // un verdict reste valable tant que la scène n'a pas bougé (caméra) ; les surfaces mobiles
    // bougent seules : pour elles, on borne aussi l'âge du verdict
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
        (!hooks.current.moving(key) || performance.now() - verdict.at < VERDICT_MS);
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
    // focus clavier : recentrer la caméra si la surface n'est pas visible
    const onFocus = (e: FocusEvent) => {
      const key = (e.target as Element).closest?.<HTMLElement>("[data-panel]")?.dataset.panel;
      if (!key) return;
      const p = layerRef.current?.panels.get(key);
      setPE(key, true);
      if (p && p.visible !== true) {
        const c = hooks.current.center(key);
        if (c) map.easeTo({ center: c, duration: 450 });
      }
      map.triggerRepaint();
    };
    const onBlur = () => map.triggerRepaint();
    map.on("move", onCamera);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onDown, true);
    canvas.addEventListener("focusin", onFocus);
    canvas.addEventListener("focusout", onBlur);
    return () => {
      map.off("move", onCamera);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onDown, true);
      canvas.removeEventListener("focusin", onFocus);
      canvas.removeEventListener("focusout", onBlur);
    };
  }, [canvas, map, layerRef, hooks]);
}
