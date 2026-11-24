"use client";
/**
 * Mode classique : chaque capteur est un marqueur DOM MapLibre portant une seule valeur, couleur selon
 * l'état. Plats et toujours au premier plan : ni perspective ni masquage par les bâtiments.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MlMap } from "maplibre-gl";
import type { Sensor } from "@/lib/aqueduc/sim";
import { SENSOR_KIND, sensorValue, STATUS_LABEL } from "../format";
import { select } from "../store";
import { useAq } from "../useAq";

type ML = typeof import("maplibre-gl");
const TONE = ["good", "warn", "bad"] as const;

function SensorMarker({ ml, map, sensor }: { ml: ML; map: MlMap; sensor: Sensor }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const r = useAq((s) => s.live.readings[sensor.idx]);
  const selected = useAq((s) => s.selection?.kind === "sensor" && s.selection.id === sensor.id);
  useEffect(() => {
    const div = document.createElement("div");
    div.className = "aq-pin";
    // le clic sur l'étiquette ne doit pas atteindre la carte (qui désélectionnerait)
    div.addEventListener("click", (e) => e.stopPropagation());
    const marker = new ml.Marker({ element: div, anchor: "bottom" }).setLngLat(sensor.at).addTo(map);
    setEl(div);
    return () => void marker.remove();
  }, [ml, map, sensor]);
  if (!el) return null;
  const value = r ? sensorValue(sensor.kind, r[0]) : "…";
  return createPortal(
    <>
      <button
        type="button"
        className="aq-tag"
        data-tone={r ? TONE[r[1]] : "good"}
        aria-pressed={selected}
        aria-label={`${SENSOR_KIND[sensor.kind].name} ${sensor.id} (simulation) : ${value}${r ? `, ${STATUS_LABEL[r[1]].toLowerCase()}` : ""}`}
        data-sensor={sensor.id}
        onClick={() => select({ kind: "sensor", id: sensor.id })}
      >
        <span className="aq-key" aria-hidden="true" />
        <span className="aq-num">{value}</span>
      </button>
      <span className="aq-stem" aria-hidden="true" />
    </>,
    el,
  );
}

export function SensorMarkers({ ml, map, sensors }: { ml: ML; map: MlMap; sensors: Sensor[] }) {
  return (
    <>
      {sensors.map((s) => (
        <SensorMarker key={s.id} ml={ml} map={map} sensor={s} />
      ))}
    </>
  );
}
