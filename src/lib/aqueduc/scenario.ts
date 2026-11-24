// Ligne de temps du scénario de bris (Simulation) : conduite maîtresse 13C1949, près de la rue des Forges.
import { CITY } from "./city";
import { isolate } from "./graph";
import type { IncidentInput, Model } from "./sim";

/** 24 novembre 2026, 06:00 heure de l'Est (UTC−5). */
export const SCENARIO_DAY = Date.UTC(2026, 10, 24, 11, 0);

export type StepId = "detection" | "isolation" | "intervention" | "retablissement" | "rapport";

const MIN = 60_000;
/** début du bris : 06:57, détecté par P-01 à 06:58 */
const BREAK_AT = SCENARIO_DAY + 57 * MIN;

export const SCENARIO_STEPS: { id: StepId; at: number; title: string; text: string }[] = [
  {
    id: "detection",
    at: SCENARIO_DAY + 58 * MIN,
    title: "06:58 · Détection",
    text: "Le capteur P-01 (simulé) signale une chute brutale de pression sur la conduite maîtresse 13C1949 : 300 mm, fonte grise de 1920, près de la rue des Forges. Le débit entrant du secteur grimpe.",
  },
  {
    id: "isolation",
    at: SCENARIO_DAY + 80 * MIN,
    title: "07:20 · Isolation",
    text: "L'équipe repère les vannes qui coupent le plus petit tronçon autour du bris. Tant qu'elles restent ouvertes, les adresses voisines sont en basse pression ; les fermer prive d'eau seulement le tronçon isolé.",
  },
  {
    id: "intervention",
    at: SCENARIO_DAY + 125 * MIN,
    title: "08:05 · Intervention",
    text: "Vannes fermées, excavation et réparation de la conduite. Les adresses du tronçon isolé sont sans eau ; le reste du secteur a retrouvé sa pression normale.",
  },
  {
    id: "retablissement",
    at: SCENARIO_DAY + 340 * MIN,
    title: "11:40 · Rétablissement",
    text: "Remise en eau progressive en dix minutes. La turbidité monte temporairement dans le secteur ; le chlore résiduel est contrôlé, avec avis d'ébullition préventif s'il passe sous 0,2 mg/L.",
  },
  {
    id: "rapport",
    at: SCENARIO_DAY + 465 * MIN,
    title: "13:45 · Rapport",
    text: "Turbidité revenue sous 0,3 UTN, pression normale partout. Le rapport résume la chronologie, les vannes manœuvrées et les adresses touchées ; la séquence peut être exportée en vidéo.",
  },
];

const stepAt = (id: StepId) => SCENARIO_STEPS.find((s) => s.id === id)!.at;
const ORDER: StepId[] = SCENARIO_STEPS.map((s) => s.id);

/**
 * Incident à appliquer à une étape. Les vannes ne sont fermées qu'à l'étape « isolation » si le visiteur
 * l'a fait (`valvesClosed`) ; après, l'équipe les a fermées dans tous les cas. Le modèle fournit l'index
 * du tronçon et les vannes qui l'isolent.
 */
export function scenarioIncident(step: StepId, valvesClosed: boolean, m: Model): IncidentInput {
  const segment = m.network.byId.get(CITY.breakSegment)!;
  const k = ORDER.indexOf(step);
  const closed = k > ORDER.indexOf("isolation") || (step === "isolation" && valvesClosed);
  return {
    segment,
    startedAt: BREAK_AT,
    closedValves: closed ? isolate(m.network, segment, m.valves).valves : [],
    restoredAt: k >= ORDER.indexOf("retablissement") ? stepAt("retablissement") : null,
  };
}
