/** Index client du réseau reçu de `/api/aqueduc/network` (module pur, sans React). */
import type { Feature, LineString } from "geojson";
import type { Sensor } from "@/lib/aqueduc/sim";
import type { ExtraTag, NetworkData, SegmentProps } from "./pipes";

export type SegmentFeature = Feature<LineString, SegmentProps>;

export interface NetIndex {
  data: NetworkData;
  /** identifiant de tronçon → index */
  segById: Map<string, number>;
  /** index de tronçon → position dans `demoSegments` (valeurs du flux) */
  demoPos: Map<number, number>;
  sensorById: Map<string, Sensor>;
  sectorById: Map<string, NetworkData["sectors"][number]>;
  /** points supplémentaires du banc, comme des capteurs de pression (idx : position dans `x` du flux) */
  extraById: Map<string, Sensor>;
}

/** Point supplémentaire du banc vu comme un capteur de pression simulé. */
export const extraSensor = (t: ExtraTag, idx: number): Sensor => ({ idx, id: t.id, kind: "pression", node: t.node, at: t.at, sector: "" });

export function indexNetwork(data: NetworkData): NetIndex {
  return {
    data,
    segById: new Map(data.segments.features.map((f) => [f.properties.id, f.properties.i])),
    demoPos: new Map(data.demoSegments.map((si, k) => [si, k])),
    sensorById: new Map(data.sensors.map((s) => [s.id, s])),
    sectorById: new Map(data.sectors.map((s) => [s.id, s])),
    extraById: new Map((data.extraTags ?? []).map((t, k) => [t.id, extraSensor(t, k)])),
  };
}

/** Tronçon par index (les features sont dans l'ordre des index). */
export const segment = (net: NetIndex, idx: number): SegmentFeature => net.data.segments.features[idx];

/** Point central d'une polyligne (sommet du milieu). */
export function lineCenter(f: SegmentFeature): [number, number] {
  const c = f.geometry.coordinates;
  const a = c[Math.floor((c.length - 1) / 2)];
  const b = c[Math.ceil((c.length - 1) / 2)];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Sans accents ni casse, pour la recherche. */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Position d'une sélection, pour y amener la caméra. */
export function selectionCenter(net: NetIndex, kind: string, id: string): [number, number] | null {
  if (kind === "segment" || kind === "incident") {
    const i = net.segById.get(id);
    return i === undefined ? null : lineCenter(segment(net, i));
  }
  if (kind === "sensor") return net.sensorById.get(id)?.at ?? null;
  if (kind === "sector") return net.sectorById.get(id)?.at ?? null;
  return null;
}
