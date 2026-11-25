// Environnements de la démo « gestion du territoire » : identifiants et métadonnées (sans React).

export type EnvId = "aqueduc" | "deneigement" | "collecte" | "zonage" | "evaluation";

export const ENVS: Record<EnvId, { title: string; icon: string; lot: 1 | 2; blurb: string }> = {
  aqueduc: { title: "Aqueduc", icon: "eau", lot: 1, blurb: "Conduites, capteurs et bris de conduite simulés sur le réseau d'eau potable." },
  deneigement: { title: "Déneigement", icon: "neige", lot: 1, blurb: "Interdiction de stationner la nuit, zones, ressources et prévision de neige." },
  collecte: { title: "Collecte", icon: "bac", lot: 2, blurb: "Secteurs de collecte des matières résiduelles et avancement des camions." },
  zonage: { title: "Zonage", icon: "zone", lot: 2, blurb: "Zones et usages permis du territoire, en consultation." },
  evaluation: { title: "Évaluation foncière", icon: "lot", lot: 2, blurb: "Lots, valeurs et rôle d'évaluation, en consultation." },
};

/** Environnements du lot 1 (les autres sont « À venir »), dans l'ordre de `ENVS`. */
export const LOT1_ENVS = (Object.keys(ENVS) as EnvId[]).filter((id) => ENVS[id].lot === 1);

export const isEnvId = (s: string | null | undefined): s is EnvId => typeof s === "string" && Object.hasOwn(ENVS, s);

/** Genres d'éléments qu'un environnement sait mettre en avant (sélection et caméra). */
export interface FocusKinds {
  aqueduc: "segment" | "sensor" | "sector" | "incident";
  deneigement: "zone" | "resource";
}
/** Élément mis en avant dans un environnement : alerte de la cloche, résultat de recherche. */
export type EnvFocus = { [E in keyof FocusKinds]: { env: E; kind: FocusKinds[E]; id: string } }[keyof FocusKinds];
