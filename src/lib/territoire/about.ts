/**
 * Contenu de « À propos » (spec 5.1) : avertissement « non officielle », sources et licences,
 * attributions affichées, réel et simulé par environnement, constantes de la journée de démo.
 * Module pur : la page, l'accueil et les tests le lisent.
 */
import { CITY } from "../aqueduc/city";
import { DAY_TIMES } from "./day";
import type { EnvId } from "./envs";
import { METEO_ATTRIBUTION, SNOW_THRESHOLD_CM } from "./meteo";

/** Phrase exigée par la spec, mot pour mot. */
export const NON_OFFICIAL =
  "Démo non officielle. Ni la Ville de Trois-Rivières ni aucune autre municipalité n'a produit, vérifié ou approuvé cette démo.";

export const ZONES_ATTRIBUTION = "Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0";
export const BASEMAP_ATTRIBUTION = "Fond de carte : OpenFreeMap / OpenMapTiles / OpenStreetMap";

/** Les quatre lignes d'attribution affichées là où les données apparaissent. */
export const ATTRIBUTIONS = [CITY.attribution.split(" · ")[0], ZONES_ATTRIBUTION, METEO_ATTRIBUTION, BASEMAP_ATTRIBUTION] as const;

export interface Source {
  dataset: string;
  publisher: string;
  licence: string;
  licenceHref: string;
  href: string;
  linkLabel: string;
  use: string;
}

const CC_BY = "https://creativecommons.org/licenses/by/4.0/deed.fr";

export const SOURCES: Source[] = [
  {
    dataset: "Conduites d'eau potable",
    publisher: "Ville de Trois-Rivières",
    licence: "CC-BY 4.0",
    licenceHref: CC_BY,
    href: "https://www.donneesquebec.ca/recherche/dataset/7ad4ea4e-cfc5-417b-9eb8-6e7f379a8f6e",
    linkLabel: "Données Québec",
    use: "Tracé des 24 137 tronçons de l'environnement Aqueduc",
  },
  {
    dataset: "Stationnement de nuit",
    publisher: "Ville de Trois-Rivières",
    licence: "CC-BY 4.0",
    licenceHref: CC_BY,
    href: "https://www.donneesquebec.ca/recherche/dataset/63037f5c-f592-4538-89b2-8a850e758b97",
    linkLabel: "Données Québec",
    use: "Zones A, B et C de l'environnement Déneigement",
  },
  {
    dataset: "Météo de la ville (GéoMet, citypageweather)",
    publisher: "Environnement et Changement climatique Canada",
    licence: "Licence du gouvernement ouvert – Canada",
    licenceHref: "https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada",
    href: "https://api.weather.gc.ca/collections/citypageweather-realtime",
    linkLabel: "API GéoMet",
    use: "Conditions actuelles, prévision et neige des prochaines 36 h (accueil, Déneigement)",
  },
  {
    dataset: "Fond de carte (style « liberty »)",
    publisher: "OpenFreeMap, OpenMapTiles, contributeurs OpenStreetMap",
    licence: "ODbL (données OpenStreetMap)",
    licenceHref: "https://www.openstreetmap.org/copyright",
    href: "https://openfreemap.org",
    linkLabel: "openfreemap.org",
    use: "Rues, bâtiments 3D et noms de lieux de toutes les vues",
  },
];

/** Réel et simulé, environnement par environnement (spec 5.4). */
export const REALITY: Record<EnvId, { real: string; simulated: string }> = {
  aqueduc: {
    real: "Le tracé des conduites (diamètre, matériau, année de pose, classe).",
    simulated: "Capteurs, mesures, secteurs, adresses desservies, débits et le bris de conduite de 14 h.",
  },
  deneigement: {
    real: "Les trois zones de stationnement de nuit ; la prévision d'Environnement Canada quand elle annonce de la neige.",
    simulated: "Feux d'interdiction (inspirés du système de la Ville de Québec), ressources, avancement, neige quand la prévision réelle n'en annonce pas.",
  },
  collecte: { real: "Rien : aucun jeu ouvert de collecte n'a été trouvé.", simulated: "Secteurs et horaires (lot 2, à venir)." },
  zonage: { real: "Les 1 666 zones du règlement de zonage (lot 2, à venir).", simulated: "Rien : consultation seulement." },
  evaluation: { real: "Le rôle d'évaluation foncière 2026, caviardé (lot 2, à venir).", simulated: "Rien : consultation seulement, aucune réidentification." },
};

/** Constantes de la journée de démo, documentées (spec 5.2) ; heures locales de Trois-Rivières. */
export const DEMO_CONSTANTS: { label: string; value: string }[] = [
  { label: "Levée automatique de l'interdiction de la nuit", value: DAY_TIMES.banEnd },
  { label: "Prévision de neige et alerte « décider l'interdiction »", value: DAY_TIMES.forecastAt },
  { label: "Décision par défaut de la direction (simulé), si le visiteur n'a pas décidé", value: DAY_TIMES.defaultDecisionAt },
  { label: "Bris de conduite au centre-ville (scénario de l'aqueduc)", value: DAY_TIMES.breakAt },
  { label: "Limite de décision de l'interdiction pour le soir même", value: DAY_TIMES.decisionDeadline },
  { label: "Début de la neige simulée", value: DAY_TIMES.snowStart },
  { label: "Interdiction en vigueur, feux allumés, équipes sur le terrain", value: DAY_TIMES.banStart },
  { label: "Seuil de neige réelle qui déclenche l'alerte (prochaines 36 h)", value: `${SNOW_THRESHOLD_CM} cm` },
  { label: "Neige simulée quand la prévision n'en annonce pas", value: "12 cm" },
];

/** Pistes pour essayer la démo. */
export const TRY_IT = [
  "Ouvrir une alerte de l'accueil : la vue 3D de son environnement s'ouvre sur l'objet en cause.",
  "Dans l'Aqueduc, lancer le scénario de bris et fermer les vannes dans la coupe sous la rue.",
  "Passer de l'Aqueduc au Déneigement avec le sélecteur : la carte ne se recharge pas.",
  "Déplacer le curseur de la frise de 24 h : alertes et états suivent l'heure simulée.",
];
