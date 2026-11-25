"use client";
/**
 * Mode HTML-in-Canvas, option A : les panneaux sont de vrais éléments HTML montés DANS le canvas
 * de MapLibre (portail React, après hydratation), capturés au handler `paint` et dessinés par une
 * custom layer qui partage la profondeur des bâtiments.
 *
 * La mécanique générique (paint, vérification, garde-fous, hit testing avec occlusion) est dans
 * `../hic3d/HicHost` ; ici restent ce qui est propre à la carte de livraison : clés des
 * restaurants et livreurs, ancres (les livreurs bougent), réglages du store, latence
 * statut -> pixel des restaurants (`statusChangedAt`).
 */
import { useMemo } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "zustand";
import { RESTAURANTS } from "@/lib/carte/catalog";
import { HicHost, type HicHostProps, type SurfaceSpec } from "../hic3d/HicHost";
import type { Metrics } from "../hic3d/metrics";
import { CourierPanel, PANEL_SIZE, RestaurantPanel } from "./Panels";
import { carteStore, couriers, statusChangedAt } from "./store";

type ML = typeof import("maplibre-gl");

/** Lu à chaque image par la couche : ancres et réglages viennent de l'état courant. */
const LAYER_OPTIONS: HicHostProps["layerOptions"] = {
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
    return { fog: st.fog, shadow: st.shadow, transition: st.transition, transitionMs: st.transitionMs };
  },
};

const markActive = () => {
  if (carteStore.getState().api !== "active") carteStore.setState({ api: "active" });
};

export function HicPanels({ ml, map, metrics, onFallback }: { ml: ML; map: MlMap; metrics: Metrics; onFallback(reason: string): void }) {
  const s = useStore(carteStore);
  const surfaces = useMemo<SurfaceSpec[]>(
    () => [
      ...s.openRestaurants.map((idx) => ({
        key: `r${idx}`,
        ...PANEL_SIZE.restaurant,
        version: 0,
        focusable: true,
        render: () => <RestaurantPanel idx={idx} drawable />,
        // latence statut -> pixel : instant de réception du dernier changement de statut
        changedAt: () => statusChangedAt[idx],
      })),
      ...s.openCouriers.map((idx) => ({
        key: `c${idx}`,
        ...PANEL_SIZE.courier,
        version: 0,
        focusable: true,
        moving: true,
        render: () => <CourierPanel idx={idx} drawable />,
      })),
    ],
    [s.openRestaurants, s.openCouriers],
  );
  return <HicHost ml={ml} map={map} metrics={metrics} surfaces={surfaces} layerOptions={LAYER_OPTIONS} onFallback={onFallback} onActive={markActive} />;
}
