// Ligne de temps du scénario de bris (Simulation) : conduite maîtresse 13C1949, près de la rue des Forges.
import { CITY } from "./city";
import { isolate } from "./graph";
import type { IncidentInput, Model } from "./sim";
import { atHour, dayStartOf, DAY_TIMES } from "../territoire/day";

/** 24 novembre 2026, minuit heure de l'Est (UTC−5) : journée de référence des tests, du banc et des preuves. */
export const SCENARIO_DAY = Date.UTC(2026, 10, 24, 5, 0);

export type StepId = "detection" | "isolation" | "intervention" | "retablissement" | "rapport";

export interface ScenarioStep {
  id: StepId;
  at: number;
  title: string;
  text: string;
}

/** Début du bris : 14:00 de la journée locale, détecté par P-01 à 14:01. */
export const breakAt = (day: number) => atHour(day, DAY_TIMES.breakAt);

const STEP_DEFS: { id: StepId; hhmm: string; title: string; text: string }[] = [
  {
    id: "detection",
    hhmm: "14:01",
    title: "14:01 · Détection",
    text: "Le capteur P-01 (simulé) signale une chute brutale de pression sur la conduite maîtresse 13C1949 : 300 mm, fonte grise de 1920, près de la rue des Forges. Le débit entrant du secteur grimpe.",
  },
  {
    id: "isolation",
    hhmm: "14:23",
    title: "14:23 · Isolation",
    text: "L'équipe repère les vannes qui coupent le plus petit tronçon autour du bris. Tant qu'elles restent ouvertes, les adresses voisines sont en basse pression ; les fermer prive d'eau seulement le tronçon isolé.",
  },
  {
    id: "intervention",
    hhmm: "15:08",
    title: "15:08 · Intervention",
    text: "Vannes fermées, excavation et réparation de la conduite. Les adresses du tronçon isolé sont sans eau ; le reste du secteur a retrouvé sa pression normale.",
  },
  {
    id: "retablissement",
    hhmm: "18:43",
    title: "18:43 · Rétablissement",
    text: "Remise en eau progressive en dix minutes. La turbidité monte temporairement dans le secteur ; le chlore résiduel est contrôlé, avec avis d'ébullition préventif s'il passe sous 0,2 mg/L.",
  },
  {
    id: "rapport",
    hhmm: "20:48",
    title: "20:48 · Rapport",
    text: "Turbidité revenue sous 0,3 UTN, pression normale partout. Le rapport résume la chronologie, les vannes manœuvrées et les adresses touchées ; la séquence peut être exportée en vidéo.",
  },
];

/** Étapes du scénario pour la journée locale `day` (minuit local). */
export function scenarioSteps(day: number): ScenarioStep[] {
  return STEP_DEFS.map(({ hhmm, ...s }) => ({ ...s, at: atHour(day, hhmm) }));
}

const ORDER: StepId[] = STEP_DEFS.map((s) => s.id);

/** Étape en cours à l'heure simulée t : la dernière commencée de sa journée (détection avant 14:01). */
export function stepAtTime(t: number): StepId {
  let id: StepId = ORDER[0];
  for (const s of scenarioSteps(dayStartOf(t))) if (s.at <= t) id = s.id;
  return id;
}

/** Paramètres de l'incident d'une étape (sans le tronçon, toujours `CITY.breakSegment`). */
export interface ScenarioIncidentParams {
  startedAt: number;
  closedValves: number[];
  restoredAt: number | null;
}

/**
 * Incident d'une étape de la journée `day` à partir des seules vannes qui isolent le tronçon :
 * utilisable par le client, qui n'a pas le modèle (les vannes lui viennent du serveur). Les vannes
 * ne sont fermées qu'à l'étape « isolation » si le visiteur l'a fait (`valvesClosed`) ; après,
 * l'équipe les a fermées dans tous les cas.
 */
export function scenarioIncidentParams(step: StepId, valvesClosed: boolean, valves: readonly number[], day: number): ScenarioIncidentParams {
  const k = ORDER.indexOf(step);
  const closed = k > ORDER.indexOf("isolation") || (step === "isolation" && valvesClosed);
  return {
    startedAt: breakAt(day),
    closedValves: closed ? [...valves] : [],
    restoredAt: k >= ORDER.indexOf("retablissement") ? scenarioSteps(day)[ORDER.indexOf("retablissement")].at : null,
  };
}

/**
 * Incident de la journée à l'heure t (horloge commune) : null avant le bris de 14:00. Les vannes sont
 * fermées dès `isolatedAt` (le visiteur) ou à l'étape d'intervention (par défaut), la première des deux.
 */
export function dayIncident(t: number, isolatedAt: number | null, valves: readonly number[]): ScenarioIncidentParams | null {
  const day = dayStartOf(t);
  const startedAt = breakAt(day);
  if (t < startedAt) return null;
  const steps = scenarioSteps(day);
  const at = (id: StepId) => steps[ORDER.indexOf(id)].at;
  const closedAt = Math.min(isolatedAt ?? Infinity, at("intervention"));
  return { startedAt, closedValves: t >= closedAt ? [...valves] : [], restoredAt: at("retablissement") };
}

/**
 * Incident à appliquer à une étape, pour le modèle (serveur, tests) : le modèle fournit l'index du
 * tronçon et les vannes qui l'isolent.
 */
export function scenarioIncident(step: StepId, valvesClosed: boolean, m: Model, day: number): IncidentInput {
  const segment = m.network.byId.get(CITY.breakSegment)!;
  return { segment, ...scenarioIncidentParams(step, valvesClosed, isolate(m.network, segment, m.valves).valves, day) };
}
