"use client";
/**
 * Carte opérationnelle 3D : MapLibre (tuiles vectorielles OpenFreeMap, bâtiments extrudés),
 * caméra inclinée, deux modes de panneaux sur le même store.
 */
import { useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "zustand";
import { CITIES, COURIERS, RESTAURANTS, type CityId } from "@/lib/carte/catalog";
import { detectApi } from "../hic/detect";
import { Metrics } from "../metrics";
import { RobotView } from "../wall/RobotView";
import { ClassicOverlay } from "./ClassicOverlay";
import { createDynamicsLayer } from "./dynamics";
import { HicPanels } from "./HicPanels";
import { setRefresh } from "./Panels";
import { applyRestaurants, carteStore, couriers, toggleCourier, toggleRestaurant, type CarteMode, type RestaurantView } from "./store";
import { CarteToolbar } from "./Toolbar";
import { CarteMetrics } from "./CarteMetrics";

type ML = typeof import("maplibre-gl");
export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

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
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
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
        const rs = RESTAURANTS.filter((r) => r.city === st.city).slice(0, nR).map((r) => r.idx);
        const cs = COURIERS.filter((c) => c.city === st.city).slice(0, nC).map((c) => c.idx);
        carteStore.setState({ openRestaurants: rs, openCouriers: cs });
      },
    };
    return () => {
      delete w.__carte;
    };
  }, [ctx]);

  return (
    <div className="carte-stage">
      <CarteToolbar map={ctx?.map ?? null} />
      {s.fallback && (
        <div className="fallback" role="status" data-testid="fallback">
          {s.fallback}
        </div>
      )}
      <div className="carte-map" ref={container} data-mode={s.mode}>
        {ctx && s.mode === "classic" && <ClassicOverlay ml={ctx.ml} map={ctx.map} />}
        {ctx && s.mode === "hic" && (
          <HicPanels
            ml={ctx.ml}
            map={ctx.map}
            metrics={ctx.metrics}
            onFallback={(reason) => carteStore.setState({ mode: "classic", fallback: `Mode classique activé automatiquement : ${reason}` })}
          />
        )}
      </div>
      {ctx && <CarteMetrics metrics={ctx.metrics} />}
      {s.robotOpen && <RobotView onClose={() => carteStore.setState({ robotOpen: false })} />}
    </div>
  );
}
