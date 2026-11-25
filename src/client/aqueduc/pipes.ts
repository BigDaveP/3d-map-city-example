/**
 * Couches MapLibre des conduites, des capteurs et des secteurs, expressions de couleur par couche
 * et retouches du fond de carte. Aucun import de MapLibre à l'exécution (types seulement) : le module
 * se teste sous Node.
 */
import type { FeatureCollection, LineString } from "geojson";
import type { ExpressionSpecification, Map as MlMap } from "maplibre-gl";
import { FLUSHING_2026, type Sensor } from "@/lib/aqueduc/sim";
import type { LayerId } from "./store";

/** Gris neutre : conduite sans valeur (hors zone suivie, année inconnue). */
export const NO_DATA = "#a3adba";
const BAD = "#d23b2b";

/**
 * Paliers de couleur par couche (valeur → couleur), partagés par `pipeColor`, la légende et la
 * couleur RGB des tubes souterrains (`rampColor`). Pression : paliers de la décision R12 (4,0 et 5,2 bar en
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

/** Couleur RGB (0–255) d'une valeur sur des paliers (interpolation RGB linéaire, comme MapLibre). */
function rampRgb(stops: Stops, v: number): [number, number, number] {
  const rgb = (c: string): [number, number, number] => {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  if (v <= stops[0][0]) return rgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v <= v1) {
      const [v0, c0] = stops[i - 1];
      const u = (v - v0) / (v1 - v0);
      const a = rgb(c0);
      const b = rgb(c1);
      return [0, 1, 2].map((k) => Math.round(a[k] * (1 - u) + b[k] * u)) as [number, number, number];
    }
  }
  return rgb(stops[stops.length - 1][1]);
}

/** Couleur d'une valeur sur des paliers (interpolation RGB linéaire, comme MapLibre). */
export function rampHex(stops: Stops, v: number): string {
  const [r, g, b] = rampRgb(stops, v);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Couleur RGB (0–255) d'une valeur de la couche, sur les mêmes paliers que `pipeColor` (tubes souterrains). */
export function rampColor(layer: LayerId, value: number): [number, number, number] {
  return rampRgb(PIPE_STOPS[layer].stops, value);
}

/** Gris neutre et rouge d'incident en RGB, pour les tubes. */
export const NO_DATA_RGB = rampRgb([[0, NO_DATA]], 0);
export const BAD_RGB = rampRgb([[0, BAD]], 0);

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
  /** plan d'isolation du tronçon du scénario, calculé par le serveur */
  scenario: {
    segment: string;
    /** nœuds des vannes à fermer */
    valves: number[];
    /** tronçons privés d'eau une fois les vannes fermées */
    isolated: number[];
    path: import("@/lib/aqueduc/graph").IsolationPath | null;
    /** adresses (estimées, simulées) en basse pression vannes ouvertes, sans eau vannes fermées */
    impact: { lowPressure: number; withoutWater: number };
  };
  attribution: string;
  demoSegments: number[];
  /** points de mesure supplémentaires, simulés, réservés au banc (`setTags`, R7) */
  extraTags: ExtraTag[];
}
export interface ExtraTag {
  /** « X-001 » */
  id: string;
  node: number;
  at: [number, number];
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

/**
 * Sources et couches : conduites (`aq-pipes-casing`, `aq-pipes`) et capteurs (`aq-sensors`). Les noms
 * de secteurs et les étiquettes sont du HTML (`scene/` en mode HTML-in-Canvas, `classic/` sinon).
 */
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
  state.set(map, { demo: data.demoSegments, last: {}, sel: null, inc: null });
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
 * Noms de lieux masqués : la ville (posée sur le marquage du secteur Centre-ville) et les quartiers,
 * dont les noms recoupent ceux des secteurs simulés, placés ailleurs (OpenFreeMap « liberty »).
 */
const HIDE_PLACES = new Set(["label_city", "label_other"]);

/**
 * Fond de carte sobre (valeurs des maquettes) : seuls les noms de rues et de lieux restent (sauf
 * la ville et les quartiers) ;
 * bâtiments #dde2e8 à 0,78 d'opacité.
 */
export function restyleBasemap(map: MlMap) {
  for (const l of map.getStyle().layers ?? []) {
    if (l.type !== "symbol" || l.id.startsWith("aq-")) continue;
    const sl = (l as { "source-layer"?: string })["source-layer"] ?? "";
    if (!KEEP_SYMBOLS.has(sl) || l.id.includes("shield") || HIDE_PLACES.has(l.id)) map.setLayoutProperty(l.id, "visibility", "none");
  }
  if (map.getLayer(BEFORE)) {
    map.setPaintProperty(BEFORE, "fill-extrusion-color", "#dde2e8");
    map.setPaintProperty(BEFORE, "fill-extrusion-opacity", 0.78);
  }
}

/** Opacités de la vue souterraine : sol, routes et eau estompés, bâtiments translucides. */
export const UNDERGROUND_OPACITY = { ground: 0.25, buildings: 0.35 };
type PaintProp = Parameters<MlMap["setPaintProperty"]>[1];
type PaintValue = Parameters<MlMap["setPaintProperty"]>[2];
const saved = new WeakMap<MlMap, [string, PaintProp, PaintValue][]>();

/**
 * Vue souterraine : couches de sol, de routes et d'eau (remplissages et lignes du fond) à 0,25,
 * bâtiments à 0,35, conduites au sol masquées. `aq-pipes` passe à une opacité nulle plutôt qu'en
 * `visibility: none` : elle reste interrogeable au clic, au droit des tubes. Les valeurs d'origine
 * sont rendues telles quelles à la sortie.
 */
export function setUnderground(map: MlMap, on: boolean) {
  if (!on) {
    for (const [id, prop, v] of saved.get(map) ?? []) if (map.getLayer(id)) map.setPaintProperty(id, prop, v);
    saved.delete(map);
    if (map.getLayer("aq-pipes-casing")) map.setLayoutProperty("aq-pipes-casing", "visibility", "visible");
    return;
  }
  if (saved.has(map)) return;
  const list: [string, PaintProp, PaintValue][] = [];
  const set = (id: string, prop: PaintProp, v: number) => {
    list.push([id, prop, map.getPaintProperty(id, prop) as PaintValue]);
    map.setPaintProperty(id, prop, v);
  };
  for (const l of map.getStyle().layers ?? []) {
    if (l.id === "aq-pipes") set(l.id, "line-opacity", 0);
    else if (l.id.startsWith("aq-")) continue;
    else if (l.type === "fill") set(l.id, "fill-opacity", UNDERGROUND_OPACITY.ground);
    else if (l.type === "line") set(l.id, "line-opacity", UNDERGROUND_OPACITY.ground);
    else if (l.type === "fill-extrusion") set(l.id, "fill-extrusion-opacity", UNDERGROUND_OPACITY.buildings);
  }
  saved.set(map, list);
  if (map.getLayer("aq-pipes-casing")) map.setLayoutProperty("aq-pipes-casing", "visibility", "none");
}

/** Couches interrogées au clic, de la plus précise à la plus étendue. */
export const PICK_LAYERS = ["aq-sensors", "aq-pipes"];
