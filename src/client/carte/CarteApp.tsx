"use client";
/**
 * Carte opérationnelle 3D : MapLibre (tuiles vectorielles OpenFreeMap, bâtiments extrudés),
 * caméra inclinée, deux modes de panneaux sur le même store.
 */
import { useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "zustand";
import { CARTE_VIDEO_CREDITS, CITIES, COURIERS, RESTAURANTS, type CityId } from "@/lib/carte/catalog";
import { detectApi } from "../hic3d/detect";
import { STYLE_URL, WORKER_URL } from "../aqueduc/mapStyle";
import { Metrics } from "../hic3d/metrics";
import { RobotView } from "../wall/RobotView";
import { ClassicOverlay } from "./ClassicOverlay";
import { createDynamicsLayer } from "./dynamics";
import { HicPanels } from "./HicPanels";
import { setRefresh } from "./Panels";
import { applyRestaurants, carteStore, couriers, toggleCourier, toggleRestaurant, type CarteMode, type RestaurantView } from "./store";
import { CarteToolbar } from "./Toolbar";
import { MetricsDetail } from "../aqueduc/ui/MetricsDetail";
import { download, recordMap } from "../aqueduc/video";

/** Enregistre 10 s du canvas et propose le fichier ; le résultat reste accessible au banc. */
async function exportVideo(map: MlMap) {
  const mode = carteStore.getState().mode;
  carteStore.setState({ recording: "enregistrement" });
  try {
    const r = await recordMap(map, CARTE_VIDEO_CREDITS, 10_000);
    (window as unknown as Record<string, unknown>).__lastVideo = { ...r, mode };
    download(r.url, `carte-${mode === "hic" ? "html-in-canvas" : "classique"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`);
  } finally {
    carteStore.setState({ recording: "prêt" });
  }
}

type ML = typeof import("maplibre-gl");
export { STYLE_URL };

export default function CarteApp({ initialMode, initialCity }: { initialMode?: CarteMode; initialCity?: CityId }) {
  const container = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<{ ml: ML; map: MlMap; metrics: Metrics } | null>(null);
  const s = useStore(carteStore);

  // --- carte
  useEffect(() => {
    let disposed = false;
    let map: MlMap | undefined;
    const api = detectApi();
    const city = CITIES[initialCity ?? "mtl"];
    const wanted: CarteMode = initialMode ?? (api.present ? "hic" : "classic");
    carteStore.setState({
      city: city.id,
      api: api.present ? "détectée" : "absente",
      apiDetail: api.detail,
      mode: api.present ? wanted : "classic",
      fallback: api.present ? "" : `Mode classique activé automatiquement : API HTML-in-Canvas absente (${api.detail}).`,
    });
    import("maplibre-gl").then((ml) => {
      if (disposed || !container.current) return;
      ml.setWorkerUrl(WORKER_URL);
      const metrics = new Metrics();
      map = new ml.Map({
        container: container.current,
        style: STYLE_URL,
        center: city.center,
        zoom: city.zoom,
        pitch: 62,
        bearing: city.bearing,
        maxPitch: 75,
        canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false },
        attributionControl: { compact: false },
      });
      map.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-right");
      map.on("load", () => {
        if (map!.getLayer("building-3d")) map!.setPaintProperty("building-3d", "fill-extrusion-opacity", 0.92);
        map!.addLayer(createDynamicsLayer(ml, (ms) => metrics.addWork?.(ms)));
        setCtx({ ml, map: map!, metrics });
      });
      // clic sur la carte : livreur le plus proche, sinon restaurant (en mode classique, les marqueurs DOM gèrent les restaurants)
      map.on("click", (e) => {
        const st = carteStore.getState();
        const now = performance.now();
        let best = -1;
        let bestD = 18;
        COURIERS.forEach((c, i) => {
          if (c.city !== st.city || !couriers.known[i]) return;
          const p = map!.project(couriers.position(i, now));
          const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
          if (d < bestD) {
            best = i;
            bestD = d;
          }
        });
        if (best >= 0) return toggleCourier(best);
        let bestR = -1;
        let bestRD = 26;
        RESTAURANTS.forEach((r) => {
          if (r.city !== st.city) return;
          const p = map!.project([r.lng, r.lat]);
          const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
          if (d < bestRD) {
            bestR = r.idx;
            bestRD = d;
          }
        });
        if (bestR >= 0) toggleRestaurant(bestR);
      });
      (window as unknown as Record<string, unknown>).__map = map;
    });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [initialMode, initialCity]);

  // --- sources : SSE des livreurs, polling des restaurants
  useEffect(() => {
    const es = new EventSource("/api/carte/couriers/stream");
    es.addEventListener("couriers", (ev) => couriers.push(JSON.parse((ev as MessageEvent).data).c, performance.now()));
    const poll = async () => {
      try {
        const r = await fetch("/api/carte/restaurants", { cache: "no-store" });
        const b = await r.json();
        applyRestaurants(b.restaurants as RestaurantView[], b.assignments, b.persistence, performance.now());
      } catch {}
    };
    setRefresh(poll);
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, []);

  // --- changement de ville
  useEffect(() => {
    if (!ctx) return;
    const c = CITIES[s.city];
    ctx.map.jumpTo({ center: c.center, zoom: c.zoom, bearing: c.bearing, pitch: 62 });
  }, [ctx, s.city]);

  // --- mesure des frames
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

  // --- API de pilotage (banc, vérification)
  useEffect(() => {
    if (!ctx) return;
    const w = window as unknown as Record<string, unknown>;
    w.__carte = {
      map: ctx.map,
      metrics: ctx.metrics,
      store: carteStore,
      couriers,
      openPanels: (nR: number, nC: number) => {
        const st = carteStore.getState();
        const byCity = <T extends { city: string }>(a: T[]) => [...a.filter((x) => x.city === st.city), ...a.filter((x) => x.city !== st.city)];
        const rs = byCity(RESTAURANTS).slice(0, nR).map((r) => r.idx);
        const cs = byCity(COURIERS).slice(0, nC).map((c) => c.idx);
        carteStore.setState({ openRestaurants: rs, openCouriers: cs });
      },
    };
    return () => {
      delete w.__carte;
    };
  }, [ctx]);

  return (
    <div className="carte-stage">
      <CarteToolbar map={ctx?.map ?? null} onExport={() => ctx && void exportVideo(ctx.map)} />
      {s.fallback && (
        <div className="fallback" role="status" data-testid="fallback">
          {s.fallback}
        </div>
      )}
      <div className="carte-map" ref={container} data-mode={s.mode}>
        {ctx && s.mode === "classic" && <ClassicOverlay ml={ctx.ml} map={ctx.map} metrics={ctx.metrics} />}
        {ctx && s.mode === "hic" && (
          <HicPanels
            ml={ctx.ml}
            map={ctx.map}
            metrics={ctx.metrics}
            onFallback={(reason) => carteStore.setState({ mode: "classic", fallback: `Mode classique activé automatiquement : ${reason}` })}
          />
        )}
      </div>
      {ctx && <MetricsDetail metrics={ctx.metrics} mode={s.mode} rows={[["Panneaux ouverts", String(s.openRestaurants.length + s.openCouriers.length)]]} />}
      {s.robotOpen && <RobotView onClose={() => carteStore.setState({ robotOpen: false })} />}
    </div>
  );
}
