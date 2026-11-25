"use client";
/**
 * Hôte HTML-in-Canvas générique pour une carte MapLibre : des surfaces HTML (vrais éléments React)
 * sont montées DANS le canvas de la carte (portail, après hydratation), capturées au handler
 * `paint` et dessinées par `PanelLayer`, une custom layer qui partage la profondeur des bâtiments.
 *
 * Règles tenues ici (RULES.md, CAPABILITIES.md) :
 *  - attributs `content="drawable"` + `layoutsubtree` sur le canvas, retirés au démontage ;
 *  - upload uniquement dans `paint`, en pixels du backing store, 8 au plus par `paint`
 *    (ensemble sale persistant ; surface focalisée d'abord) ; état GL de MapLibre restauré ;
 *  - vérification `readPixels` (toute la zone capturée) des premiers uploads (puis 1 sur 100) ; repli si texture vide,
 *    exception à l'upload ou aucun `paint` en 2,5 s ;
 *  - `updateElementGeometry` (px CSS) pour chaque surface montée, à chaque image ;
 *  - surfaces `mipmap` (marquages au sol) : mipmaps et filtre anisotrope après chaque capture ;
 *  - hit testing avec occlusion (`occlusion.ts`).
 *
 * Contrat d'une surface : `render()` rend UN élément qui porte `data-panel={key}` et `drawable`,
 * de taille `w × h` px CSS. Changer `version` force une recapture ; les modifications du DOM
 * (texte, focus, saisie) sont aussi recapturées via `changedElements`.
 * `layerOptions` est lu une fois, à la création de la couche : ses fonctions doivent lire l'état
 * courant elles-mêmes.
 * Pilotage : `window.__hicMap = { layer, stats(): { uploads, verified, fallback } }`.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Map as MlMap } from "maplibre-gl";
import { PanelLayer, type PanelGpu, type PanelLayerOptions } from "../carte/hic/panelLayer";
import { detectApi } from "../hic/detect";
import type { Metrics } from "../metrics";
import { useOcclusionHitTesting, type OcclusionHooks } from "./occlusion";

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

export interface SurfaceSpec {
  key: string;
  /** taille en px CSS */
  w: number;
  h: number;
  /** change => recapture */
  version: number;
  /** peut recevoir le focus clavier : capturée en priorité et dessinée en rayons X quand elle l'a */
  focusable: boolean;
  render(): ReactNode;
  /** l'ancre bouge seule (ex. livreur) : le verdict d'occlusion sous le curseur expire après 400 ms */
  moving?: boolean;
  /**
   * Surface vue en fort raccourci (marquage au sol) : mipmaps régénérées après chaque capture,
   * filtre trilinéaire et anisotrope (8 au plus) pour éviter le crénelage et le scintillement.
   */
  mipmap?: boolean;
  /**
   * Instant (performance.now) de la dernière donnée reçue pour cette surface, lu à l'upload :
   * la latence donnée -> pixel est mesurée au dessin qui suit la recapture.
   */
  changedAt?(): number;
}

export interface HicHostProps {
  ml: ML;
  map: MlMap;
  metrics: Metrics;
  surfaces: SurfaceSpec[];
  layerOptions: Omit<PanelLayerOptions, "setGeometry" | "onRender">;
  onFallback(reason: string): void;
  onLatency?(key: string, ms: number): void;
  /** appelé après chaque vérification `readPixels` réussie */
  onActive?(): void;
}

export function HicHost({ ml, map, metrics, surfaces, layerOptions, onFallback, onLatency, onActive }: HicHostProps) {
  const canvas = map.getCanvas() as AnyCanvas;
  const keysSig = surfaces.map((s) => s.key).join("\n");
  const keys = useMemo(() => (keysSig ? keysSig.split("\n") : []), [keysSig]);
  const [ready, setReady] = useState(false);
  const layerRef = useRef<PanelLayer | null>(null);
  const cb = useRef({ onFallback, onLatency, onActive, layerOptions });
  cb.current = { onFallback, onLatency, onActive, layerOptions };
  const specsRef = useRef(new Map<string, SurfaceSpec>());
  const versionsRef = useRef(new Map<string, number>());
  // ensemble sale persistant : une surface repoussée par le budget reste à capturer au paint suivant
  const dirtyRef = useRef(new Set<string>());

  // --- couche, paint, garde-fous
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const api = detectApi();
    if (!api.present || !canvas.updateElementGeometry) {
      const reason = `API HTML-in-Canvas absente (${api.detail})`;
      w.__hicMap = { layer: null, stats: () => ({ uploads: 0, verified: 0, fallback: reason }) };
      cb.current.onFallback(reason);
      return;
    }
    canvas.setAttribute("content", "drawable");
    canvas.setAttribute("layoutsubtree", "");
    const gl = map.painter.context.gl as AnyGL;
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    const anisoMax = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
    let disposed = false;
    let uploads = 0;
    let verified = 0;
    let fallback: string | null = null;
    let paintSeen = false;
    const requestedAt = performance.now();
    const dirty = dirtyRef.current;
    dirty.clear();
    const fail = (reason: string) => {
      if (disposed) return;
      disposed = true;
      fallback = reason;
      cb.current.onFallback(reason);
    };
    const focusable = (key: string | null | undefined) => (key && specsRef.current.get(key)?.focusable ? key : null);
    const opts = cb.current.layerOptions;
    const layer = new PanelLayer(ml, {
      ...opts,
      focused:
        opts.focused ??
        (() => {
          const a = document.activeElement;
          return a && canvas.contains(a) ? focusable(a.closest<HTMLElement>("[data-panel]")?.dataset.panel) : null;
        }),
      setGeometry: (el, m) => canvas.updateElementGeometry!(el, { canvasTransform: m }),
      onRender: (ms, lat) => {
        metrics.addWork(ms);
        for (const l of lat) {
          metrics.latency(l.ms);
          cb.current.onLatency?.(l.key, l.ms);
        }
      },
    });
    layerRef.current = layer;
    map.addLayer(layer);

    // Upload dans le handler paint uniquement (sinon : ancien rendu ou exception).
    const onPaint = (e: Event) => {
      if (disposed) return;
      const t0 = performance.now();
      paintSeen = true;
      const ce = (e as Event & { changedElements?: ArrayLike<Element> }).changedElements;
      if (ce) for (let i = 0; i < ce.length; i++) {
        const k = (ce[i] as HTMLElement).dataset?.panel;
        if (k) dirty.add(k);
      }
      // texture manquante ou contenu changé ; la surface focalisée d'abord
      const focusedKey = focusable((document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>("[data-panel]")?.dataset.panel);
      const todo = [...layer.panels.values()].filter((p) => p.el && (!p.tex || dirty.has(p.key)));
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
        const existed = !!p.tex;
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
        if (specsRef.current.get(p.key)?.mipmap) {
          // dans le handler paint, texture liée : l'état GL est restauré plus bas avec le reste
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          if (aniso && anisoMax > 1) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, anisoMax);
        }
        metrics.capture(performance.now() - tu);
        dirty.delete(p.key);
        uploads++;
        n++;
        if (verified < VERIFY_FIRST || uploads % VERIFY_EVERY === 0) {
          verified++;
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.tex, 0);
          // toute la zone capturée : une surface à fond transparent (marquage au sol) peut avoir un
          // centre vide ; la texture n'est vide que si aucun texel n'a reçu de pixel
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          gl.deleteFramebuffer(fb);
          gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
          if (!px.some((v) => v !== 0)) {
            fail(`texture vide après upload (readPixels : ${w} × ${h} texels nuls) : l'API est détectée mais ne transmet aucun pixel`);
            break;
          }
          cb.current.onActive?.();
        }
        // latence donnée -> pixel : émise au prochain dessin de cette surface
        // (pas pour la première capture d'une surface : ce n'est pas une mise à jour)
        const at = specsRef.current.get(p.key)?.changedAt?.();
        if (at && at > (lastLatencyMark.get(p.key) ?? 0)) {
          if (existed) p.pendingLatency = at;
          lastLatencyMark.set(p.key, at);
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.activeTexture(prevUnit);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      metrics.gpuBytes = [...layer.panels.values()].reduce((a, p) => a + p.tw * p.th * 4, 0);
      // captures : travail des mises à jour de données (série `upd*` des métriques)
      metrics.update(performance.now() - t0);
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
    w.__hicMap = { layer, stats: () => ({ uploads, verified, fallback }) };
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

  // --- après chaque commit : spécifications courantes ; `version` changée => recapture
  useLayoutEffect(() => {
    const specs = new Map(surfaces.map((s) => [s.key, s]));
    specsRef.current = specs;
    const versions = versionsRef.current;
    const layer = layerRef.current;
    let changed = false;
    for (const s of surfaces) {
      const prev = versions.get(s.key);
      if (prev !== undefined && prev !== s.version) {
        dirtyRef.current.add(s.key);
        changed = true;
      }
      versions.set(s.key, s.version);
      const p = layer?.panels.get(s.key);
      if (p) {
        p.w = s.w;
        p.h = s.h;
      }
    }
    for (const k of versions.keys()) if (!specs.has(k)) versions.delete(k);
    if (changed && layer) {
      canvas.requestPaint?.();
      map.triggerRepaint();
    }
  });

  // --- quand l'ensemble monté change : enregistre les éléments des surfaces dans la couche
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
        const spec = specsRef.current.get(k);
        if (!spec) continue;
        const p: PanelGpu = { key: k, el, w: spec.w, h: spec.h, tex: null, tw: 0, th: 0, openedAt: performance.now(), proj: null, model: null, visible: null, query: null, pendingLatency: 0 };
        layer.panels.set(k, p);
      }
    }
    canvas.requestPaint?.();
    map.triggerRepaint();
  }, [keys, ready, canvas, map]);

  // --- évènements : les surfaces ne doivent pas déclencher le pan / zoom de MapLibre
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
  const hooks = useRef<OcclusionHooks>({
    moving: (key) => !!specsRef.current.get(key)?.moving,
    center: (key) => {
      const a = cb.current.layerOptions.anchor?.(key);
      if (a) return [a.lng, a.lat];
      // sans ancre (placement libre) : centre de la surface tel qu'il a été dessiné
      const p = layerRef.current?.panels.get(key);
      const m = p?.model;
      if (!p || !m) return null;
      const c = new ml.MercatorCoordinate(m[12] + (m[0] * p.w + m[4] * p.h) / 2, m[13] + (m[1] * p.w + m[5] * p.h) / 2, m[14] + (m[2] * p.w + m[6] * p.h) / 2).toLngLat();
      return [c.lng, c.lat];
    },
  });
  useOcclusionHitTesting(canvas, map, layerRef, hooks);

  if (!ready) return null;
  return createPortal(
    surfaces.map((s) => <Fragment key={s.key}>{s.render()}</Fragment>),
    canvas,
  );
}
