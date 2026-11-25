"use client";
/**
 * Mode classique : marqueur MapLibre dont le contenu est rendu par React (portail), toujours au
 * premier plan. Les inscriptions de la scène HTML-in-Canvas y deviennent des étiquettes plates.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Map as MlMap, PositionAnchor } from "maplibre-gl";

type ML = typeof import("maplibre-gl");

/** Marqueur MapLibre dont le contenu est rendu par React (portail). */
export function Pin({ ml, map, at, anchor, className, children }: { ml: ML; map: MlMap; at: [number, number]; anchor: PositionAnchor; className: string; children: ReactNode }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const div = document.createElement("div");
    div.className = className;
    // un clic sur l'étiquette ne doit pas atteindre la carte (qui désélectionnerait)
    div.addEventListener("click", (e) => e.stopPropagation());
    const marker = new ml.Marker({ element: div, anchor }).setLngLat(at).addTo(map);
    setEl(div);
    return () => void marker.remove();
  }, [ml, map, at, anchor, className]);
  return el ? createPortal(children, el) : null;
}

