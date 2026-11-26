/**
 * Fond de carte commun à tous les environnements (OpenFreeMap « liberty ») et worker MapLibre : la
 * scène le charge une fois et le retouche (`restyleBasemap`) ; les modules posent leurs couches
 * dessus. Types MapLibre seulement : le module se teste sous Node.
 */
import type { Map as MlMap } from "maplibre-gl";

export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** Worker servi par `src/app/maplibre/[file]/route.ts` (voir ce fichier pour la raison). */
export const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
/** Bâtiments 3D du fond : les couches des modules s'insèrent dessous (ils les masquent). */
export const BUILDINGS = "building-3d";

/** Symboles conservés : noms de rues et de lieux. */
const KEEP_SYMBOLS = new Set(["transportation_name", "place"]);
/**
 * Noms de lieux masqués : la ville (posée sur le marquage du secteur Centre-ville) et les quartiers,
 * dont les noms recoupent ceux des secteurs simulés, placés ailleurs (OpenFreeMap « liberty »).
 */
const HIDE_PLACES = new Set(["label_city", "label_other"]);

/**
 * Fond de carte sobre (valeurs des maquettes), une fois au chargement du style, avant toute couche
 * d'environnement : seuls les noms de rues et de lieux restent (sauf la ville et les quartiers) ;
 * bâtiments #dde2e8 à 0,78 d'opacité.
 */
export function restyleBasemap(map: MlMap) {
  for (const l of map.getStyle().layers ?? []) {
    if (l.type !== "symbol" || l.id.startsWith("aq-")) continue;
    const sl = (l as { "source-layer"?: string })["source-layer"] ?? "";
    if (!KEEP_SYMBOLS.has(sl) || l.id.includes("shield") || HIDE_PLACES.has(l.id)) map.setLayoutProperty(l.id, "visibility", "none");
  }
  if (map.getLayer(BUILDINGS)) {
    map.setPaintProperty(BUILDINGS, "fill-extrusion-color", "#dde2e8");
    map.setPaintProperty(BUILDINGS, "fill-extrusion-opacity", 0.78);
  }
}

