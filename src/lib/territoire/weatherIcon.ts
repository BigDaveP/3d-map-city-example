/**
 * Condition du ciel d'après le code d'icône d'Environnement et Changement climatique Canada
 * (`iconCode` des conditions actuelles, des prévisions horaires et des périodes de GéoMet
 * citypageweather). Module pur.
 *
 * Source : tables publiques d'ECCC (MSC Datamart, « current_conditions_icon_code_descriptions » et
 * « forecast_conditions_icon_code_descriptions », 2026) : 00 à 08 de jour, 30 à 39 de nuit, 10 à 28
 * et 40 à 48 de jour comme de nuit ; 20, 21 et 29 (« non disponible ») n'ont pas de condition.
 * Les regroupements (ex. 15 « pluie et neige » → neige) sont les nôtres : une condition par icône.
 */

export const WEATHER_CONDITIONS = [
  "soleil",
  "lune",
  "peu-nuageux",
  "nuageux",
  "couvert",
  "pluie",
  "averses",
  "neige",
  "averses-neige",
  "pluie-verglacante",
  "grele",
  "orage",
  "brouillard",
  "vent",
  "inconnu",
] as const;

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

/** Code ECCC → condition (sans la distinction jour / nuit, réglée à part pour le ciel dégagé). */
const BY_CODE: Record<number, WeatherCondition> = {
  // de jour
  0: "soleil", // Ensoleillé
  1: "peu-nuageux", // Généralement ensoleillé, quelques nuages
  2: "peu-nuageux", // Alternance de soleil et de nuages
  3: "nuageux", // Généralement nuageux
  4: "nuageux", // Ennuagement
  5: "peu-nuageux", // Dégagement
  6: "averses", // Averses légères, possibilité d'averses
  7: "averses-neige", // Averses de pluie ou de neige
  8: "averses-neige", // Averses de neige légères
  9: "orage", // Possibilité d'orages
  // de jour comme de nuit
  10: "couvert", // Nuageux, couvert
  11: "pluie", // Précipitations, grains
  12: "pluie", // Pluie faible, averses
  13: "pluie", // Pluie, pluie forte
  14: "pluie-verglacante", // Pluie ou bruine verglaçante
  15: "neige", // Pluie et neige (la neige décide pour le déneigement)
  16: "neige", // Neige faible, averses de neige
  17: "neige", // Neige
  18: "neige", // Neige forte, blizzard
  19: "orage", // Orage avec pluie
  22: "peu-nuageux", // Alternance de soleil et de nuages
  23: "brouillard", // Brume sèche
  24: "brouillard", // Brouillard, bancs de brouillard
  25: "vent", // Poudrerie basse (neige soulevée par le vent)
  26: "neige", // Cristaux de glace
  27: "grele", // Grêle, grésil, granules de glace
  28: "pluie", // Bruine (et neige en grains)
  // de nuit
  30: "lune", // Dégagé
  31: "peu-nuageux", // Généralement dégagé
  32: "peu-nuageux", // Partiellement nuageux
  33: "nuageux", // Généralement nuageux
  34: "nuageux", // Ennuagement
  35: "peu-nuageux", // Dégagement
  36: "averses", // Averses légères
  37: "averses-neige", // Averses de pluie ou de neige
  38: "averses-neige", // Averses de neige légères
  39: "orage", // Orages
  // phénomènes, de jour comme de nuit
  40: "neige", // Poudrerie, neige et poudrerie
  41: "vent", // Nuage en entonnoir
  42: "vent", // Tornade
  43: "vent", // Venteux
  44: "brouillard", // Fumée
  45: "vent", // Tempête de poussière, cendres
  46: "grele", // Orage avec grêle
  47: "orage", // Orage avec poussière
  48: "vent", // Trombe marine
};

/** Codes propres à la nuit (30 à 39). */
export const isNightCode = (code: number): boolean => code >= 30 && code <= 39;

/**
 * Condition à afficher pour un code ECCC. `isNight` vient de l'heure (lever et coucher du soleil) ;
 * un code de nuit (30 à 39) suffit aussi. Seul le ciel dégagé change d'icône (soleil ou lune) ; les
 * autres conditions gardent la leur, et `WeatherIcon` dessine la lune pour « peu nuageux » la nuit.
 */
export function weatherCondition(code: number | null, isNight: boolean): WeatherCondition {
  if (code === null || !Number.isInteger(code)) return "inconnu";
  const c = BY_CODE[code];
  if (!c) return "inconnu";
  if (c === "soleil" || c === "lune") return isNight || isNightCode(code) ? "lune" : "soleil";
  return c;
}
