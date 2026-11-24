"use client";
/**
 * Étiquette d'un capteur : une seule valeur, couleur selon l'état. Le même bouton sert d'étiquette
 * plate (marqueur DOM du mode classique) et de surface face caméra dans la scène (`drawable`).
 */
import { useEffect, useMemo, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { CITY } from "@/lib/aqueduc/city";
import type { Sensor } from "@/lib/aqueduc/sim";
import { useThrottled } from "../../hic3d/useThrottled";
import { SENSOR_KIND, sensorValue, STATUS_LABEL } from "../format";
import type { NetIndex } from "../net";
import { select } from "../store";
import { useAq } from "../useAq";
import { pickTags, SURFACE_SIZE, surfaceKey, TONE } from "./marks";

/**
 * Capteurs étiquetés (décision R13, mêmes règles dans les deux modes) : couche active, attention ou
 * alerte, sélection ; 8 au plus, les plus proches du centre de la vue. Recalculé à la fin d'un
 * mouvement de caméra et quand la couche, la sélection ou les statuts changent (pas à chaque image).
 */
export function useTaggedSensors(map: MlMap, net: NetIndex): Sensor[] {
  const [center, setCenter] = useState<[number, number]>(() => map.getCenter().toArray() as [number, number]);
  useEffect(() => {
    const update = () => setCenter(map.getCenter().toArray() as [number, number]);
    map.on("moveend", update);
    return () => void map.off("moveend", update);
  }, [map]);
  const layer = useAq((s) => s.layer);
  const selected = useAq((s) => (s.selection?.kind === "sensor" ? s.selection.id : null));
  // statuts en une chaîne (« 0010… »), au plus toutes les 2 s : un capteur qui oscille autour d'un seuil ne fait pas clignoter les étiquettes
  const statuses = useThrottled(useAq((s) => s.live.readings.map((r) => r[1]).join("")));
  const ids = useMemo(
    () => pickTags(net.data.sensors, { layer, status: Array.from(statuses, Number), selected, center, box: CITY.demoBox }).join(","),
    [net, layer, statuses, selected, center],
  );
  return useMemo(() => (ids ? ids.split(",").map((id) => net.sensorById.get(id)!) : []), [ids, net]);
}

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
