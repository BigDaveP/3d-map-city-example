// Configuration de la ville du démo : Trois-Rivières.
export interface CityConfig {
  id: "trois-rivieres";
  name: string;
  center: [number, number];
  /** [ouest, sud, est, nord] */
  demoBox: [number, number, number, number];
  dataFile: string;
  attribution: string;
  /** tronçon du scénario de bris */
  breakSegment: string;
  sectorSeeds: { id: string; name: string; at: [number, number] }[];
}

export const CITY: CityConfig = {
  id: "trois-rivieres",
  name: "Trois-Rivières",
  center: [-72.5436, 46.3446],
  demoBox: [-72.575, 46.33, -72.52, 46.36],
  dataFile: "data/aqueduc/trois-rivieres.json",
  attribution:
    "Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4.0 · Fond de carte : OpenFreeMap, OpenMapTiles, OpenStreetMap",
  breakSegment: "13C1949",
  sectorSeeds: [
    { id: "centre-ville", name: "Centre-ville", at: [-72.543, 46.344] },
    { id: "sainte-cecile", name: "Sainte-Cécile", at: [-72.552, 46.35] },
    { id: "saint-sacrement", name: "Saint-Sacrement", at: [-72.56, 46.354] },
    { id: "notre-dame-des-sept-allegresses", name: "Notre-Dame-des-Sept-Allégresses", at: [-72.548, 46.356] },
    { id: "saint-philippe", name: "Saint-Philippe", at: [-72.556, 46.342] },
    { id: "cap-de-la-madeleine", name: "Cap-de-la-Madeleine", at: [-72.513, 46.372] },
    { id: "trois-rivieres-ouest", name: "Trois-Rivières-Ouest", at: [-72.6, 46.335] },
    { id: "pointe-du-lac", name: "Pointe-du-Lac", at: [-72.68, 46.295] },
    { id: "sainte-marthe-du-cap", name: "Sainte-Marthe-du-Cap", at: [-72.46, 46.395] },
    { id: "saint-louis-de-france", name: "Saint-Louis-de-France", at: [-72.53, 46.415] },
  ],
};

/** Mention des données simulées, à côté de l'attribution (carte, vidéo exportée, vidéo du bandeau). */
export const SIM_CREDIT = "Capteurs, mesures et incidents : simulation";
/** Crédits de la vidéo du scénario : attribution des conduites et du fond de carte, puis la simulation. */
export const VIDEO_CREDITS = [CITY.attribution, SIM_CREDIT] as const;

/**
 * Banc de mesures (R7) : points de mesure supplémentaires simulés que le réseau et le flux exposent,
 * au plus `EXTRA_TAGS_MAX` ; identifiants « X-001 », « X-002 »… Partagé par le serveur et le client.
 */
export const EXTRA_TAGS_MAX = 120;
export const EXTRA_TAG_PREFIX = "X-";
/** Identifiant du k-ième point supplémentaire (k à partir de 0). */
export const extraTagId = (k: number) => `${EXTRA_TAG_PREFIX}${String(k + 1).padStart(3, "0")}`;
