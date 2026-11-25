"use client";
/**
 * Démo réseau d'eau potable : carte MapLibre 3D de Trois-Rivières, conduites réelles colorées par la
 * couche active, capteurs simulés reçus par SSE, sélection au clic, et les cinq éléments d'interface
 * (barre, couches, frise, fiche à la sélection, récit pendant le scénario de bris).
 */
import { useEffect, useRef, useState } from "react";
import type { CameraOptions, Map as MlMap, MapGeoJSONFeature } from "maplibre-gl";
import { CITY } from "@/lib/aqueduc/city";
import { detectApi } from "../hic/detect";
import { STYLE_URL, WORKER_URL } from "../mapStyle";
import { Metrics } from "../metrics";
import { ClassicScene } from "./classic/ClassicScene";
import { indexNetwork, lineCenter, segment, type NetIndex } from "./net";
import {
  applyPipeLayers,
  markSegment,
  PICK_LAYERS,
  restyleBasemap,
  setPipeLayer,
  setPipeValues,
  setSensorStatus,
  type NetworkData,
} from "./pipes";
import { attachScenario, exploreFreely, faceBearing, goToStep, startScenario, STEP_VIEW, stepSelection, type CameraTarget } from "./scenarioController";
import { cutLayout } from "./scene/cut";
import { attachUnderground, TUBE_DEPTH_M, TUBE_EXAGGERATION, type TubeLayer } from "./scene/tubes";
import { SceneSurfaces } from "./scene/Surfaces";
import { aqueducStore, select, type AqState, type Mode, type Selection } from "./store";
import { AppBar } from "./ui/AppBar";
import { Inspector } from "./ui/Inspector";
import { Layers } from "./ui/Layers";
import { Story } from "./ui/Story";
import { Timeline } from "./ui/Timeline";
import { useAq } from "./useAq";
import { useAqueducStream } from "./useAqueducStream";

type ML = typeof import("maplibre-gl");

/** Vue d'ouverture : centre-ville, inclinée, cap vers le nord-ouest. */
export const START_VIEW = { center: CITY.center, zoom: 15.4, pitch: 58, bearing: -25 };

/** Marges de la caméra pendant le scénario : récit à gauche, frise en bas, fiche à droite si ouverte. */
const GAP = 14;
const STORY_W = 300;
const TIMELINE_H = 118;
const INSPECTOR_W = 320;

/**
 * Caméra du scénario (easeTo) : vue de l'étape, centrée sur le bris ou sur la coupe, dans la partie
 * de la carte que le récit et la fiche laissent libre. « start » retient la vue du visiteur, « exit »
 * la lui rend sans marges.
 */
function scenarioCamera(map: MlMap, net: NetIndex) {
  const cut = cutLayout(net);
  const i = net.segById.get(CITY.breakSegment);
  const brk = i === undefined ? CITY.center : lineCenter(segment(net, i));
  let saved: CameraOptions | null = null;
  return (target: CameraTarget, duration: number) => {
    if (target === "start") {
      saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      return;
    }
    const wide = map.getContainer().clientWidth > 720;
    if (target === "exit") {
      map.easeTo({ ...(saved ?? START_VIEW), padding: { left: 0, right: 0, top: 0, bottom: 0 }, duration });
      saved = null;
      return;
    }
    const v = STEP_VIEW[target];
    const { mode, scenario } = aqueducStore.getState();
    const card = stepSelection(target, mode, scenario.valvesClosed) !== null;
    const onCut = v.on === "cut" && cut !== null;
    const center: [number, number] = onCut ? [(cut.from[0] + cut.to[0]) / 2, (cut.from[1] + cut.to[1]) / 2] : brk;
    map.easeTo({
      center,
      zoom: wide ? v.zoom : v.zoom - 0.8,
      pitch: v.pitch,
      bearing: onCut ? faceBearing(cut.from, cut.to) + v.bearing : v.bearing,
      duration,
      padding: wide
        ? { left: STORY_W + GAP, right: card ? INSPECTOR_W + GAP : 0, top: 0, bottom: TIMELINE_H + GAP }
        : { left: 0, right: 0, top: 0, bottom: 0 },
    });
  };
}

/** Élément de la carte sous le pointeur : capteur, puis conduite (les secteurs et étiquettes sont du HTML). */
function pick(map: MlMap, x: number, y: number): Selection {
  const pad = 5;
  const found = map.queryRenderedFeatures(
    [
      [x - pad, y - pad],
      [x + pad, y + pad],
    ],
    { layers: PICK_LAYERS },
  );
  const by = (id: string) => found.find((f: MapGeoJSONFeature) => f.layer.id === id);
  const sensor = by("aq-sensors");
  if (sensor) return { kind: "sensor", id: String(sensor.properties.id) };
  const pipe = by("aq-pipes");
  if (pipe) {
    const id = String(pipe.properties.id);
    const { incident } = aqueducStore.getState();
    return { kind: incident && id === CITY.breakSegment ? "incident" : "segment", id };
  }
  return null;
}

/** Reporte l'état du store sur la carte (hors React : une fois par message du flux). */
function syncMap(map: MlMap, net: NetIndex, s: AqState, prev: AqState | null) {
  if (!prev || s.layer !== prev.layer) setPipeLayer(map, s.layer);
  if (!prev || s.live !== prev.live) {
    setPipeValues(map, "pression", s.live.pressure);
    setPipeValues(map, "qualite", s.live.chlorine);
    setSensorStatus(map, net.data.sensors, s.live.readings);
  }
  if (!prev || s.selection !== prev.selection) {
    const sel = s.selection;
    markSegment(map, "sel", sel && (sel.kind === "segment" || sel.kind === "incident") ? (net.segById.get(sel.id) ?? null) : null);
  }
  if (!prev || s.incident !== prev.incident) markSegment(map, "inc", s.incident ? (net.segById.get(CITY.breakSegment) ?? null) : null);
}

export default function AqueducApp({ initialMode }: { initialMode?: Mode }) {
  const container = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<{ ml: ML; map: MlMap; metrics: Metrics; net: NetIndex } | null>(null);
  const [error, setError] = useState("");
  const [tubes, setTubes] = useState<TubeLayer | null>(null);
  const mode = useAq((s) => s.mode);
  const underground = useAq((s) => s.underground);

  // la vue SSR (résumé lisible sans JavaScript) laisse la place à l'application
  useEffect(() => {
    document.documentElement.dataset.aq = "app";
    return () => void delete document.documentElement.dataset.aq;
  }, []);

  // --- détection de l'API, carte et données du réseau
  useEffect(() => {
    let disposed = false;
    let map: MlMap | undefined;
    const api = detectApi();
    const hic = initialMode === "hic" && api.present;
    aqueducStore.setState({
      api: api.present ? "détectée" : "absente",
      mode: hic ? "hic" : "classic",
      fallback: initialMode === "hic" && !api.present ? `Mode classique : API HTML-in-Canvas absente (${api.detail}).` : "",
    });
    const data = fetch("/api/aqueduc/network").then((r) => {
      if (!r.ok) throw new Error(`réseau : HTTP ${r.status}`);
      return r.json() as Promise<NetworkData>;
    });
    data.catch(() => {});
    import("maplibre-gl")
      .then((ml) => {
        if (disposed || !container.current) return;
        ml.setWorkerUrl(WORKER_URL);
        const metrics = new Metrics();
        const m = new ml.Map({
          container: container.current,
          style: STYLE_URL,
          ...START_VIEW,
          maxPitch: 75,
          canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false },
          attributionControl: { compact: window.matchMedia("(max-width: 720px)").matches, customAttribution: [CITY.attribution.split(" · ")[0], "Capteurs, mesures et incidents : simulation"] },
        });
        map = m;
        m.on("load", async () => {
          try {
            restyleBasemap(m);
            const d = await data;
            if (disposed) return;
            applyPipeLayers(m, d, aqueducStore.getState().layer);
            setCtx({ ml, map: m, metrics, net: indexNetwork(d) });
          } catch (e) {
            setError(`Le réseau n'a pas pu être chargé (${(e as Error).message}).`);
          }
        });
        m.on("click", (e) => select(pick(m, e.point.x, e.point.y)));
        for (const id of PICK_LAYERS) {
          m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
        }
      })
      .catch((e) => setError(`La carte n'a pas pu démarrer (${(e as Error).message}).`));
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [initialMode]);

  // --- flux des capteurs (attend la carte : la mesure de latence en dépend)
  useAqueducStream(ctx?.metrics ?? null);

  // --- store → carte
  useEffect(() => {
    if (!ctx) return;
    syncMap(ctx.map, ctx.net, aqueducStore.getState(), null);
    return aqueducStore.subscribe((s, prev) => {
      const t = performance.now();
      syncMap(ctx.map, ctx.net, s, prev);
      ctx.metrics.addWork(performance.now() - t);
    });
  }, [ctx]);

  // --- mesure des images
  useEffect(() => {
    if (!ctx) return;
    let raf = 0;
    const tick = (now: number) => {
      ctx.metrics.frameEnd(ctx.metrics.pendingWork());
      ctx.metrics.frameStart(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ctx]);

  // --- vue souterraine : tubes 3D sous la rue, fond estompé
  useEffect(() => {
    if (!ctx) return;
    const u = attachUnderground(ctx.map, ctx.net, (ms) => ctx.metrics.addWork(ms));
    setTubes(u.layer);
    return () => {
      u.detach();
      setTubes(null);
    };
  }, [ctx]);

  // --- scénario de bris : vannes du plan d'isolation (serveur) et caméra
  useEffect(() => {
    if (!ctx) return;
    return attachScenario({ valves: ctx.net.data.scenario.valves, camera: scenarioCamera(ctx.map, ctx.net) });
  }, [ctx]);

  // --- API de pilotage (vérifications de bout en bout, banc)
  useEffect(() => {
    if (!ctx) return;
    const w = window as unknown as Record<string, unknown>;
    w.__aqueduc = {
      map: ctx.map,
      metrics: ctx.metrics,
      store: aqueducStore,
      net: ctx.net,
      tubes,
      scenario: { start: startScenario, goTo: goToStep, explore: exploreFreely },
    };
    return () => void delete w.__aqueduc;
  }, [ctx, tubes]);

  return (
    <div className="aq-app" data-mode={mode}>
      <AppBar map={ctx?.map ?? null} net={ctx?.net ?? null} metrics={ctx?.metrics ?? null} tubes={tubes?.stats ?? null} />
      <main className="aq-stage">
        <div className="aq-map" ref={container} role="region" aria-label="Carte 3D du réseau d'aqueduc de Trois-Rivières" />
        {!ctx && !error && (
          <p className="aq-loading" role="status">
            Chargement du réseau de conduites…
          </p>
        )}
        {error && (
          <p className="aq-loading aq-bad" role="alert">
            {error}
          </p>
        )}
        {ctx && mode === "classic" && <ClassicScene ml={ctx.ml} map={ctx.map} net={ctx.net} />}
        {ctx && mode === "hic" && <SceneSurfaces ml={ctx.ml} map={ctx.map} metrics={ctx.metrics} net={ctx.net} />}
        {/* avant les couches : sur un écran étroit, le panneau déplié passe par-dessus la mention */}
        {ctx && underground && (
          <p className="aq-under-note" role="status">
            Diamètres exagérés ×{TUBE_EXAGGERATION} · conduites à {TUBE_DEPTH_M} m sous la rue
          </p>
        )}
        <Layers />
        {ctx && <Story map={ctx.map} net={ctx.net} />}
        {ctx && <Inspector net={ctx.net} />}
        <Timeline />
      </main>
    </div>
  );
}
