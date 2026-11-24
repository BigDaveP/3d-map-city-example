/**
 * Couches MapLibre des conduites, des capteurs et des secteurs, expressions de couleur par couche
 * et retouches du fond de carte. Aucun import de MapLibre à l'exécution (types seulement) : le module
 * se teste sous Node.
 */
import type { FeatureCollection, LineString } from "geojson";
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { FLUSHING_2026, type Sensor } from "@/lib/aqueduc/sim";
import { num } from "./format";
import type { LayerId } from "./store";

/** Gris neutre : conduite sans valeur (hors zone suivie, année inconnue). */
export const NO_DATA = "#a3adba";
const BAD = "#d23b2b";

/**
 * Paliers de couleur par couche (valeur → couleur), partagés par `pipeColor`, la légende et, plus
 * tard, la couleur RGB des tubes souterrains. Pression : paliers de la décision R12 (4,0 et 5,2 bar en
 * haut de l'échelle, pour qu'un réseau sain varie du clair au foncé avec la distance aux sources).
 */
export const PIPE_STOPS = {
  pression: {
    unit: "bar",
    stops: [
      [1.2, "#d6402f"],
      [2.6, "#e8a33a"],
      [4.0, "#2f9bd6"],
      [5.2, "#1f5fa8"],
    ],
  },
  qualite: {
    unit: "mg/L",
    stops: [
      [0.15, "#d23b2b"],
      [0.3, "#d98a12"],
      [0.5, "#5fb27f"],
      [1.0, "#16703c"],
    ],
  },
  age: {
    unit: "",
    stops: [
      [1900, "#6e3519"],
      [1945, "#b4652b"],
      [1975, "#e2b75e"],
      [2000, "#7db5d8"],
      [2020, "#1f5fa8"],
    ],
  },
  /** période de rinçage 2026 : indice dans FLUSHING_2026 (mai → octobre) */
  rincage: {
    unit: "",
    stops: [
      [0, "#e4dcfa"],
      [9, "#4a2ea3"],
    ],
  },
  /** bris antérieurs simulés depuis 2009 */
  incidents: {
    unit: "",
    stops: [
      [0, "#c9d0da"],
      [1, "#d98a12"],
      [3, BAD],
    ],
  },
} as const satisfies Record<LayerId, { unit: string; stops: readonly (readonly [number, string])[] }>;

type Stops = readonly (readonly [number, string])[];
const flat = (stops: Stops) => stops.flatMap(([v, c]) => [v, c]);

/** Couleur d'une valeur sur des paliers (interpolation RGB linéaire, comme MapLibre). */
export function rampHex(stops: Stops, v: number): string {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v <= v1) {
      const [v0, c0] = stops[i - 1];
      const u = (v - v0) / (v1 - v0);
      const a = parseInt(c0.slice(1), 16);
      const b = parseInt(c1.slice(1), 16);
      const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - u) + ((b >> s) & 255) * u);
      return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
    }
  }
  return stops[stops.length - 1][1];
}

/** Couleur de la période de rinçage de chaque secteur. */
export const FLUSH_COLORS: string[] = FLUSHING_2026.map((_, k) => rampHex(PIPE_STOPS.rincage.stops, k));

/** Expression de couleur des conduites pour une couche. */
export function pipeColor(layer: LayerId): ExpressionSpecification {
  const interp = (input: ExpressionSpecification, stops: Stops) =>
    ["interpolate", ["linear"], input, ...flat(stops)] as unknown as ExpressionSpecification;
  switch (layer) {
    case "pression":
    case "qualite": {
      const key = layer === "pression" ? "p" : "q";
      return [
        "case",
        ["==", ["typeof", ["feature-state", key]], "number"],
        interp(["number", ["feature-state", key], 0], PIPE_STOPS[layer].stops),
        NO_DATA,
      ];
    }
    case "age":
      return ["case", ["==", ["typeof", ["get", "y"]], "number"], interp(["number", ["get", "y"], 0], PIPE_STOPS.age.stops), NO_DATA];
    case "rincage":
      return ["match", ["get", "s"], ...FLUSHING_2026.flatMap((f, k) => [f.sectorId, FLUSH_COLORS[k]]), NO_DATA] as unknown as ExpressionSpecification;
    case "incidents":
      return ["case", ["boolean", ["feature-state", "inc"], false], BAD, interp(["number", ["get", "b"], 0], PIPE_STOPS.incidents.stops)];
  }
}

/** Largeur selon la classe et le zoom (px). */
const CLASS_WIDTH: ExpressionSpecification = ["match", ["get", "c"], "amenee", 5.5, "maitresse", 4, "distribution", 2.2, 1.1];
const selected: ExpressionSpecification = ["boolean", ["feature-state", "sel"], false];
/** `zoom` doit rester au premier niveau : la sélection élargit la ligne à l'intérieur de chaque palier. */
const pipeWidth = (extra: number, extraSel: number): ExpressionSpecification => {
  const add: ExpressionSpecification = ["case", selected, extraSel, extra];
  return ["interpolate", ["exponential", 1.6], ["zoom"], 11, ["+", ["*", 0.3, CLASS_WIDTH], ["*", 0.5, add]], 15, ["+", CLASS_WIDTH, add], 18, ["+", ["*", 2.6, CLASS_WIDTH], ["*", 1.5, add]]];
};

export interface NetworkData {
  segments: FeatureCollection<LineString, SegmentProps>;
  sensors: Sensor[];
  sectors: { id: string; name: string; addresses: number; at: [number, number] }[];
  valves: { node: number; at: [number, number] }[];
  attribution: string;
  demoSegments: number[];
}
export interface SegmentProps {
  i: number;
  id: string;
  d: number;
  m: import("@/lib/aqueduc/network").Material;
  y: number | null;
  c: import("@/lib/aqueduc/network").PipeClass;
  s: string;
  /** longueur (m) */
  l: number;
  /** bris antérieurs simulés */
  b: number;
}

/** Calque devant lequel insérer les conduites (les bâtiments les masquent). */
const BEFORE = "building-3d";
const state = new WeakMap<MlMap, { demo: number[]; last: Record<string, Float32Array>; sel: number | null; inc: number | null }>();

/** Sources et couches : conduites (`aq-pipes-casing`, `aq-pipes`), capteurs (`aq-sensors`), secteurs (`aq-sectors`). */
export function applyPipeLayers(map: MlMap, data: NetworkData, layer: LayerId = "pression") {
  const before = map.getLayer(BEFORE) ? BEFORE : undefined;
  map.addSource("aq-net", { type: "geojson", data: data.segments, promoteId: "i", attribution: "" });
  map.addLayer(
    {
      id: "aq-pipes-casing",
      type: "line",
      source: "aq-net",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["case", selected, "#142133", "#ffffff"],
        "line-width": pipeWidth(2, 7),
        "line-opacity": ["case", selected, 1, 0.85],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: "aq-pipes",
      type: "line",
      source: "aq-net",
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["match", ["get", "c"], "amenee", 3, "maitresse", 2, "distribution", 1, 0] },
      paint: { "line-color": pipeColor(layer), "line-width": pipeWidth(0, 2) },
    },
    before,
  );
  map.addSource("aq-sensors", {
    type: "geojson",
    promoteId: "id",
    data: {
      type: "FeatureCollection",
      features: data.sensors.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: s.at }, properties: { id: s.id, kind: s.kind } })),
    },
  });
  map.addLayer({
    id: "aq-sensors",
    type: "circle",
    source: "aq-sensors",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 16, 4.5],
      "circle-color": ["match", ["number", ["feature-state", "st"], 0], 2, BAD, 1, "#d98a12", "#1c8a4a"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-pitch-alignment": "map",
    },
  });
  map.addSource("aq-sectors", { type: "geojson", promoteId: "id", data: sectorFeatures(data, (id) => data.sectors.find((x) => x.id === id)!.addresses) });
  map.addLayer({
    id: "aq-sectors",
    type: "symbol",
    source: "aq-sectors",
    layout: {
      // un seul chiffre par secteur : les adresses desservies (estimation)
      "text-field": ["format", ["get", "name"], { "font-scale": 1 }, "\n", {}, ["get", "label"], { "font-scale": 0.62, "text-font": ["literal", ["Noto Sans Regular"]] }],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11, 12, 15, 20],
      "text-letter-spacing": 0.18,
      "text-pitch-alignment": "map",
      "text-rotation-alignment": "map",
      "text-allow-overlap": false,
      // sous la graine : la station de qualité du secteur est juste au-dessus
      "text-anchor": "top",
      "text-offset": [0, 0.8],
    },
    paint: { "text-color": "rgba(10, 92, 194, 0.78)", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.6 },
  });
  state.set(map, { demo: data.demoSegments, last: {}, sel: null, inc: null });
}

const sectorFeatures = (data: NetworkData, served: (id: string) => number): FeatureCollection => ({
  type: "FeatureCollection",
  features: data.sectors.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: s.at },
    properties: { id: s.id, name: s.name.toUpperCase(), label: `${num(served(s.id))} adresses desservies` },
  })),
});

/** Un seul chiffre par secteur : adresses desservies (estimation), mis à jour par le flux. */
export function setSectorServed(map: MlMap, data: NetworkData, served: (id: string) => number) {
  (map.getSource("aq-sectors") as GeoJSONSource | undefined)?.setData(sectorFeatures(data, served));
}

export function setPipeLayer(map: MlMap, layer: LayerId) {
  if (map.getLayer("aq-pipes")) map.setPaintProperty("aq-pipes", "line-color", pipeColor(layer));
}

/**
 * Valeurs du flux (alignées sur `demoSegments`) en feature-state : pression → `p`, chlore → `q`.
 * Seules les valeurs qui changent sont écrites. L'âge, le rinçage et les bris sont des propriétés statiques.
 */
export function setPipeValues(map: MlMap, layer: LayerId, values: Float32Array) {
  const st = state.get(map);
  const key = layer === "pression" ? "p" : layer === "qualite" ? "q" : null;
  if (!st || !key || !map.getSource("aq-net")) return;
  const last = st.last[key];
  for (let i = 0; i < st.demo.length && i < values.length; i++) {
    if (last && last[i] === values[i]) continue;
    map.setFeatureState({ source: "aq-net", id: st.demo[i] }, { [key]: values[i] });
  }
  st.last[key] = values;
}

/** Statut (0, 1, 2) de chaque capteur pour la couleur de son point. */
export function setSensorStatus(map: MlMap, sensors: Sensor[], readings: [number, number][]) {
  if (!map.getSource("aq-sensors")) return;
  readings.forEach((r, i) => sensors[i] && map.setFeatureState({ source: "aq-sensors", id: sensors[i].id }, { st: r[1] }));
}

/** Tronçon mis en évidence : sélection (`sel`) ou incident en cours (`inc`). */
export function markSegment(map: MlMap, what: "sel" | "inc", idx: number | null) {
  const st = state.get(map);
  if (!st || !map.getSource("aq-net") || st[what] === idx) return;
  if (st[what] !== null) map.setFeatureState({ source: "aq-net", id: st[what]! }, { [what]: false });
  if (idx !== null) map.setFeatureState({ source: "aq-net", id: idx }, { [what]: true });
  st[what] = idx;
}

/** Symboles conservés : noms de rues et de lieux. */
const KEEP_SYMBOLS = new Set(["transportation_name", "place"]);

/**
 * Fond de carte sobre (valeurs des maquettes) : seuls les noms de rues et de lieux restent ;
 * bâtiments #dde2e8 à 0,78 d'opacité.
 */
export function restyleBasemap(map: MlMap) {
  for (const l of map.getStyle().layers ?? []) {
    if (l.type !== "symbol" || l.id.startsWith("aq-")) continue;
    const sl = (l as { "source-layer"?: string })["source-layer"] ?? "";
    if (!KEEP_SYMBOLS.has(sl) || l.id.includes("shield")) map.setLayoutProperty(l.id, "visibility", "none");
  }
  if (map.getLayer(BEFORE)) {
    map.setPaintProperty(BEFORE, "fill-extrusion-color", "#dde2e8");
    map.setPaintProperty(BEFORE, "fill-extrusion-opacity", 0.78);
  }
}

/** Couches interrogées au clic, de la plus précise à la plus étendue. */
export const PICK_LAYERS = ["aq-sensors", "aq-sectors", "aq-pipes"];
