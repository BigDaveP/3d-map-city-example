"use client";
/**
 * Démo réseau d'eau potable : carte MapLibre 3D de Trois-Rivières, conduites réelles colorées par la
 * couche active, capteurs simulés reçus par SSE, sélection au clic, et les cinq éléments d'interface
 * (barre, couches, frise, fiche ; le récit viendra avec le scénario).
 */
import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, MapGeoJSONFeature } from "maplibre-gl";
import { CITY } from "@/lib/aqueduc/city";
import { detectApi } from "../hic/detect";
import { STYLE_URL, WORKER_URL } from "../mapStyle";
import { Metrics } from "../metrics";
import { SensorMarkers } from "./classic/SensorMarkers";
import { indexNetwork, type NetIndex } from "./net";
import {
  applyPipeLayers,
  markSegment,
  PICK_LAYERS,
  restyleBasemap,
  setPipeLayer,
  setPipeValues,
  setSectorServed,
  setSensorStatus,
  type NetworkData,
} from "./pipes";
import { aqueducStore, select, type AqState, type Mode, type Selection } from "./store";
import { AppBar } from "./ui/AppBar";
import { Inspector } from "./ui/Inspector";
import { Layers } from "./ui/Layers";
import { Timeline } from "./ui/Timeline";
import { useAq } from "./useAq";
import { useAqueducStream } from "./useAqueducStream";

type ML = typeof import("maplibre-gl");

/** Vue d'ouverture : centre-ville, inclinée, cap vers le nord-ouest. */
export const START_VIEW = { center: CITY.center, zoom: 15.4, pitch: 58, bearing: -25 };

/** Élément sous le pointeur : capteur, puis secteur, puis conduite. */
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
  const sector = by("aq-sectors");
  if (sector) return { kind: "sector", id: String(sector.properties.id) };
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
    const served = s.live.sectors.map((x) => x.served).join();
    if (served && served !== (prev?.live.sectors.map((x) => x.served).join() ?? "")) {
      setSectorServed(map, net.data, (id) => s.live.sectors.find((x) => x.id === id)?.served ?? 0);
    }
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
  const mode = useAq((s) => s.mode);

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

  // --- API de pilotage (vérifications de bout en bout, banc)
  useEffect(() => {
    if (!ctx) return;
    const w = window as unknown as Record<string, unknown>;
    w.__aqueduc = { map: ctx.map, metrics: ctx.metrics, store: aqueducStore, net: ctx.net };
    return () => void delete w.__aqueduc;
  }, [ctx]);

  return (
    <div className="aq-app" data-mode={mode}>
      <AppBar map={ctx?.map ?? null} net={ctx?.net ?? null} metrics={ctx?.metrics ?? null} />
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
        {ctx && mode === "classic" && <SensorMarkers ml={ctx.ml} map={ctx.map} sensors={ctx.net.data.sensors} />}
        <Layers />
        {ctx && <Inspector net={ctx.net} />}
        <Timeline />
      </main>
    </div>
  );
}
