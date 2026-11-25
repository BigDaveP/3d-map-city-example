"use client";
/**
 * Étiquette d'un capteur : une seule valeur, couleur selon l'état. Le même bouton sert d'étiquette
 * plate (marqueur DOM du mode classique) et de surface face caméra dans la scène (`drawable`).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { CITY } from "@/lib/aqueduc/city";
import type { Sensor } from "@/lib/aqueduc/sim";
import { useThrottled } from "../../hic3d/useThrottled";
import { SENSOR_KIND, sensorValue, STATUS_LABEL } from "../format";
import type { NetIndex } from "../net";
import { aqueducStore, select } from "../store";
import { tagCommitted, tagRenderStart } from "../tagWork";
import { useAq } from "../useAq";
import { benchTags, convexOverlap, isExtraTag, pickTags, SURFACE_SIZE, surfaceKey, TONE, type Quad } from "./marks";

/** Où tombent à l'écran les étiquettes et les chiffres des marquages, selon le mode. */
export interface TagCover {
  /** zone d'écran de l'étiquette d'un capteur projeté en `p` (px du canvas) */
  tag(p: { x: number; y: number }): Quad;
  /** zones d'écran des chiffres des marquages affichés (secteurs, incident) */
  figures(): Quad[];
}

/**
 * Capteurs étiquetés (décision R13, mêmes règles dans les deux modes) : sélection, alerte, attention,
 * couche active ; 8 au plus, les plus proches du centre de la vue ; une étiquette qui cacherait le
 * chiffre d'un marquage est écartée. Recalculé à la fin d'un mouvement de caméra et quand la couche,
 * la sélection, les statuts ou les marquages changent (pas à chaque image).
 */
export function useTaggedSensors(map: MlMap, net: NetIndex, cover: TagCover): Sensor[] {
  const [center, setCenter] = useState<[number, number]>(() => map.getCenter().toArray() as [number, number]);
  useEffect(() => {
    const update = () => setCenter(map.getCenter().toArray() as [number, number]);
    map.on("moveend", update);
    return () => void map.off("moveend", update);
  }, [map]);
  const bench = useAq((s) => s.benchTags);
  const layer = useAq((s) => s.layer);
  const selected = useAq((s) => (s.selection?.kind === "sensor" ? s.selection.id : null));
  // statuts en une chaîne (« 0010… »), au plus toutes les 2 s : un capteur qui oscille autour d'un seuil ne fait pas clignoter les étiquettes
  const statuses = useThrottled(useAq((s) => s.live.readings.map((r) => r[1]).join("")));
  const ids = useMemo(() => {
    if (bench !== null) return benchTags(net.data.sensors, [...net.extraById.values()], bench, center, CITY.demoBox).join(",");
    const figures = cover.figures();
    const covered = (id: string) => {
      const q = cover.tag(map.project(net.sensorById.get(id)!.at));
      return figures.some((f) => convexOverlap(q, f));
    };
    return pickTags(net.data.sensors, { layer, status: Array.from(statuses, Number), selected, center, box: CITY.demoBox, covered }).join(",");
  }, [map, net, layer, statuses, selected, center, cover, bench]);
  return useMemo(() => (ids ? ids.split(",").map((id) => net.sensorById.get(id) ?? net.extraById.get(id)!) : []), [ids, net]);
}

/**
 * `onShown(receivedAt)` : la valeur affichée vient de changer (commit du DOM), avec l'instant de
 * réception du message qui l'a apportée ; pas au montage. Sert à la latence lecture → pixel.
 */
export function SensorTag({ sensor, drawable, onShown }: { sensor: Sensor; drawable?: boolean; onShown?: (receivedAt: number) => void }) {
  const extra = isExtraTag(sensor.id);
  // valeur et statut en une chaîne : comparée par valeur, recapturée au plus toutes les 2 s
  const raw = useAq((s) => {
    const r = extra ? s.live.extra[sensor.idx] : s.live.readings[sensor.idx];
    return r ? `${r[0]}|${r[1]}` : "";
  });
  const shown = useThrottled(raw);
  // instant de réception de chaque valeur reçue (la valeur affichée peut dater d'un message précédent)
  const receivedAt = useRef(new Map<string, number>());
  const lastShown = useRef(shown);
  useEffect(() => {
    const m = receivedAt.current;
    m.set(raw, aqueducStore.getState().live.receivedAt);
    for (const k of m.keys()) if (k !== raw && k !== lastShown.current) m.delete(k);
  }, [raw]);
  if (lastShown.current !== shown) tagRenderStart();
  useLayoutEffect(() => {
    if (lastShown.current === shown) return;
    lastShown.current = shown;
    tagCommitted();
    const at = receivedAt.current.get(shown);
    if (at) onShown?.(at);
  }, [shown, onShown]);
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
      aria-pressed={extra ? undefined : selected}
      aria-label={`${extra ? "Point de mesure simulé (banc de mesures)" : SENSOR_KIND[sensor.kind].name} ${sensor.id} (simulation) : ${value}${shown ? `, ${STATUS_LABEL[st].toLowerCase()}` : ""}`}
      onClick={extra ? undefined : () => select({ kind: "sensor", id: sensor.id })}
      {...scene}
    >
      <span className="aq-key" aria-hidden="true" />
      <span className="aq-num">{value}</span>
    </button>
  );
}
