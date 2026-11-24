"use client";
/**
 * Mode classique (référence) : marqueurs et popups MapLibre en DOM superposé. Les panneaux
 * sont plats, toujours au premier plan, jamais masqués par les bâtiments, et absents du canvas
 * (donc de l'export vidéo).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MlMap, Marker, Popup } from "maplibre-gl";
import { COURIERS, RESTAURANTS } from "@/lib/carte/catalog";
import type { Metrics } from "../metrics";
import { CourierPanel, panelHooks, RestaurantPanel } from "./Panels";
import { couriers, statusChangedAt, toggleRestaurant, useCarte } from "./store";

type ML = typeof import("maplibre-gl");

export function ClassicOverlay({ ml, map, metrics }: { ml: ML; map: MlMap; metrics: Metrics }) {
  const city = useCarte((s) => s.city);
  // latence statut -> pixel en DOM : commit React du panneau, puis l'image suivante
  useEffect(() => {
    const mark = new Map<number, number>();
    panelHooks.onRestaurantCommit = (idx) => {
      const at = statusChangedAt[idx];
      if (!at || at <= (mark.get(idx) ?? 0)) return;
      mark.set(idx, at);
      requestAnimationFrame(() => metrics.latency(performance.now() - at));
    };
    return () => {
      panelHooks.onRestaurantCommit = () => {};
    };
  }, [metrics]);
  const openR = useCarte((s) => s.openRestaurants);
  const openC = useCarte((s) => s.openCouriers);
  const restaurants = useMemo(() => RESTAURANTS.filter((r) => r.city === city), [city]);
  return (
    <>
      {restaurants.map((r) => (
        <RestaurantMarker key={r.idx} ml={ml} map={map} idx={r.idx} />
      ))}
      {openR.map((i) => (
        <PopupPortal key={`r${i}`} ml={ml} map={map} lngLat={() => [RESTAURANTS[i].lng, RESTAURANTS[i].lat]} offset={18}>
          <RestaurantPanel idx={i} />
        </PopupPortal>
      ))}
      {openC.map((i) => (
        <PopupPortal key={`c${i}`} ml={ml} map={map} lngLat={() => couriers.position(i, performance.now())} offset={10} follow>
          <CourierPanel idx={i} />
        </PopupPortal>
      ))}
    </>
  );
}

function RestaurantMarker({ ml, map, idx }: { ml: ML; map: MlMap; idx: number }) {
  const status = useCarte((s) => s.restaurants[idx].status);
  const [el] = useState(() => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mmarker";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleRestaurant(idx);
    });
    return b;
  });
  useEffect(() => {
    const r = RESTAURANTS[idx];
    const m: Marker = new ml.Marker({ element: el, anchor: "center" }).setLngLat([r.lng, r.lat]).addTo(map);
    return () => void m.remove();
  }, [ml, map, el, idx]);
  useEffect(() => {
    el.dataset.status = status;
    el.setAttribute("aria-label", `${RESTAURANTS[idx].name} (${status}) : ouvrir le panneau`);
  }, [el, status, idx]);
  return null;
}

function PopupPortal({ ml, map, lngLat, offset, follow, children }: { ml: ML; map: MlMap; lngLat: () => [number, number]; offset: number; follow?: boolean; children: React.ReactNode }) {
  const [container] = useState(() => document.createElement("div"));
  useEffect(() => {
    const p: Popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: "none", anchor: "bottom", offset, className: "mpopup" })
      .setLngLat(lngLat())
      .setDOMContent(container)
      .addTo(map);
    let raf = 0;
    if (follow) {
      const tick = () => {
        p.setLngLat(lngLat());
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      p.remove();
    };
    // lngLat est une fonction stable par panneau
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml, map, container, offset, follow]);
  return createPortal(children, container);
}
