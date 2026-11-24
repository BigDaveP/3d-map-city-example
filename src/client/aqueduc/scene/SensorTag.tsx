"use client";
/**
 * Étiquette d'un capteur : une seule valeur, couleur selon l'état. Le même bouton sert d'étiquette
 * plate (marqueur DOM du mode classique) et de surface face caméra dans la scène (`drawable`).
 */
import type { Sensor } from "@/lib/aqueduc/sim";
import { useThrottled } from "../../hic3d/useThrottled";
import { SENSOR_KIND, sensorValue, STATUS_LABEL } from "../format";
import { select } from "../store";
import { useAq } from "../useAq";
import { SURFACE_SIZE, surfaceKey, TONE } from "./marks";

export function SensorTag({ sensor, drawable }: { sensor: Sensor; drawable?: boolean }) {
  // valeur et statut en une chaîne : comparée par valeur, recapturée au plus toutes les 2 s
  const raw = useAq((s) => {
    const r = s.live.readings[sensor.idx];
    return r ? `${r[0]}|${r[1]}` : "";
  });
  const shown = useThrottled(raw);
  const selected = useAq((s) => s.selection?.kind === "sensor" && s.selection.id === sensor.id);
  const [v, st] = shown ? shown.split("|").map(Number) : [NaN, 0];
  const value = shown ? sensorValue(sensor.kind, v) : "…";
  const scene = drawable ? { "data-panel": surfaceKey("sensor", sensor.id), drawable: "", style: { width: SURFACE_SIZE.sensor.w, height: SURFACE_SIZE.sensor.h } } : {};
  return (
    <button
      type="button"
      className="aq-tag"
      data-tone={TONE[st] ?? "good"}
      data-sensor={sensor.id}
      aria-pressed={selected}
      aria-label={`${SENSOR_KIND[sensor.kind].name} ${sensor.id} (simulation) : ${value}${shown ? `, ${STATUS_LABEL[st].toLowerCase()}` : ""}`}
      onClick={() => select({ kind: "sensor", id: sensor.id })}
      {...scene}
    >
      <span className="aq-key" aria-hidden="true" />
      <span className="aq-num">{value}</span>
    </button>
  );
}
