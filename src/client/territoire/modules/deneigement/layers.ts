/**
 * Couches MapLibre du déneigement (sans React ; types MapLibre seulement : testé sous Node avec une
 * carte factice) :
 *  - `dn-zones` → `dn-zone-fill`, `dn-zone-line` : les trois zones de stationnement de nuit
 *    (réelles), colorées par l'état de l'interdiction (feature-state `ban`) et la sélection ;
 *  - `dn-lights` → `dn-lights` : les feux d'interdiction (Simulation), par état (feature-state
 *    `lights`) ; les feux allumés clignotent (période de 1 s, `blink`).
 * Couleurs : jetons d'état de territoire/theme.css (lus sur la page, valeurs du thème clair sinon).
 */
import type { ExpressionSpecification, Map as MlMap } from "maplibre-gl";
import type { ZoneId } from "@/lib/territoire/day";
import type { DeneigementData, ZonePlan } from "@/lib/territoire/neige";
import { BUILDINGS } from "../../scene/basemap";

/** Ce que les couches demandent à la carte (une carte factice suffit aux tests). */
export type SnowMap = Pick<MlMap, "addSource" | "addLayer" | "getLayer" | "getSource" | "removeLayer" | "removeSource" | "setFeatureState" | "setPaintProperty">;

export const SNOW_LAYERS = ["dn-lights", "dn-zone-line", "dn-zone-fill"] as const;
export const SNOW_SOURCES = ["dn-lights", "dn-zones"] as const;

/** Jetons du thème (theme.css) et leur valeur claire, utilisée hors navigateur. */
const TOKENS = {
  off: ["--state-off", "#a3adba"],
  scheduled: ["--state-scheduled", "#d98a12"],
  active: ["--state-active", "#e8590c"],
  ink: ["--tr-ink-2", "#56647a"],
  surface: ["--tr-surface", "#ffffff"],
} as const;
export type SnowColors = Record<keyof typeof TOKENS, string>;

export function snowColors(): SnowColors {
  const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const out = {} as SnowColors;
  for (const [k, [name, fallback]] of Object.entries(TOKENS) as [keyof SnowColors, readonly [string, string]][]) out[k] = css?.getPropertyValue(name).trim() || fallback;
  return out;
}

/** Feux de chaque zone, par carte (pour `setLightStates`). */
const lightsByZone = new WeakMap<SnowMap, Record<ZoneId, string[]>>();

const ban: ExpressionSpecification = ["coalesce", ["feature-state", "ban"], "aucune"];
const lightState: ExpressionSpecification = ["coalesce", ["feature-state", "lights"], "eteint"];
const selected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];

/** Opacité des feux : les feux allumés passent de 1 à 0,15 à chaque demi-période. */
const lightOpacity = (on: boolean): ExpressionSpecification => ["case", ["==", lightState, "allume"], on ? 1 : 0.15, 1];

export function applySnowLayers(map: SnowMap, data: DeneigementData, c: SnowColors = snowColors()) {
  // sous les bâtiments 3D (qui masquent les zones et les feux) et les noms de rues
  const before = map.getLayer(BUILDINGS) ? BUILDINGS : undefined;
  map.addSource("dn-zones", {
    type: "geojson",
    promoteId: "id",
    data: {
      type: "FeatureCollection",
      features: data.zones.map((z) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: z.polygon }, properties: { id: z.id, name: z.name } })),
    },
  });
  map.addSource("dn-lights", {
    type: "geojson",
    promoteId: "id",
    data: {
      type: "FeatureCollection",
      features: data.lights.map((l) => ({ type: "Feature", geometry: { type: "Point", coordinates: l.at }, properties: { id: l.id, zone: l.zone } })),
    },
  });
  map.addLayer(
    {
      id: "dn-zone-fill",
      type: "fill",
      source: "dn-zones",
      paint: {
        "fill-color": ["match", ban, "en-vigueur", c.active, "programmee", c.scheduled, c.off],
        "fill-opacity": ["case", selected, 0.26, ["match", ban, "en-vigueur", 0.16, "programmee", 0.12, 0.05]],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: "dn-zone-line",
      type: "line",
      source: "dn-zones",
      layout: { "line-join": "round" },
      paint: {
        "line-color": ["match", ban, "en-vigueur", c.active, "programmee", c.scheduled, c.ink],
        "line-width": ["case", selected, 3.5, ["match", ban, "aucune", 1.2, 2]],
        "line-opacity": ["match", ban, "aucune", 0.55, 0.95],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: "dn-lights",
      type: "circle",
      source: "dn-lights",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 14, 4, 17, 6],
        // éteint : gris plein ; programmé : anneau ambre (centre clair) ; allumé : orange plein
        "circle-color": ["match", lightState, "allume", c.active, "programme", c.surface, c.off],
        "circle-stroke-color": ["match", lightState, "allume", c.surface, "programme", c.scheduled, c.surface],
        "circle-stroke-width": ["match", lightState, "programme", 1.6, 0.8],
        "circle-opacity": lightOpacity(true),
        "circle-stroke-opacity": lightOpacity(true),
        "circle-pitch-alignment": "map",
      },
    },
    before,
  );
  const byZone: Record<ZoneId, string[]> = { A: [], B: [], C: [] };
  for (const l of data.lights) byZone[l.zone].push(l.id);
  lightsByZone.set(map, byZone);
}

/** État de l'interdiction de chaque zone (feature-state `ban`), un appel par zone. */
export function setZoneStates(map: SnowMap, plans: readonly ZonePlan[]) {
  for (const p of plans) map.setFeatureState({ source: "dn-zones", id: p.zone }, { ban: p.ban });
}

/** Zone sélectionnée (trait épais, fond plus soutenu) ; null : aucune. */
export function setSelectedZone(map: SnowMap, zone: ZoneId | null) {
  for (const z of ["A", "B", "C"] as const) map.setFeatureState({ source: "dn-zones", id: z }, { selected: z === zone });
}

/** État des feux (feature-state `lights`) : décider pour une zone change d'un coup tous ses feux. */
export function setLightStates(map: SnowMap, plans: readonly ZonePlan[]) {
  const byZone = lightsByZone.get(map);
  if (!byZone) return;
  for (const p of plans) for (const id of byZone[p.zone]) map.setFeatureState({ source: "dn-lights", id }, { lights: p.lights });
}

/** Demi-période du clignotement des feux allumés (allumé, puis éteint : 1 s). */
export const BLINK_HALF_MS = 500;

/** Phase du clignotement : `on` feux allumés pleins, sinon atténués. */
export function blink(map: SnowMap, on: boolean) {
  if (!map.getLayer("dn-lights")) return;
  map.setPaintProperty("dn-lights", "circle-opacity", lightOpacity(on));
  map.setPaintProperty("dn-lights", "circle-stroke-opacity", lightOpacity(on));
}

export function removeSnowLayers(map: SnowMap) {
  for (const id of SNOW_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SNOW_SOURCES) if (map.getSource(id)) map.removeSource(id);
  lightsByZone.delete(map);
}
