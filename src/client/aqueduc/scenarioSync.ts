/**
 * Accord de l'aqueduc avec l'horloge commune (sans React : testé sous Node) : l'incident découle de
 * l'heure simulée et des actions du visiteur (`currentIncident`), et, pendant le scénario guidé,
 * l'état des vannes de la coupe et la fiche ouverte d'office suivent. Le module de l'aqueduc branche
 * le réseau chargé (`attachScenario`) ; le scénario lui-même est dans `scenarioController.ts`.
 */
import { CITY } from "@/lib/aqueduc/city";
import type { StepId } from "@/lib/aqueduc/scenario";
import { simNow, territoireStore, type Mode } from "../territoire/store";
import { aqueducStore, currentIncident, incidentQuery, isolatedAt, type Selection } from "./store";

export type CameraTarget = StepId | "start" | "exit";

export interface ScenarioEnv {
  /** nœuds des vannes qui isolent le tronçon du scénario (plan du serveur) */
  valves: number[];
  /** caméra : vue de l'étape ; « start » retient la vue du visiteur, « exit » la lui rend */
  camera?(target: CameraTarget, durationMs: number): void;
}

const INCIDENT: Selection = { kind: "incident", id: CITY.breakSegment };

let env: ScenarioEnv = { valves: [] };

/** Réseau branché : vannes du plan et caméra (vide hors de l'environnement Aqueduc). */
export const scenarioEnv = (): ScenarioEnv => env;

/**
 * Fiche ouverte d'office à une étape : à l'isolation, en mode classique, la coupe est dans la fiche
 * de l'incident ; en mode HTML-in-Canvas elle est dans la scène, et la fiche ne s'ouvre qu'une fois
 * les vannes fermées (pour en montrer l'effet).
 */
export function stepSelection(step: StepId, mode: Mode, valvesClosed: boolean): Selection {
  return step === "isolation" && (mode === "classic" || valvesClosed) ? INCIDENT : null;
}

/**
 * Pendant le scénario, les vannes de la coupe suivent la décision du visiteur à l'heure t : fermées
 * (toutes tournées) dès son isolation, ouvertes avant. Au passage, la fiche suit la règle de
 * l'isolation (`stepSelection`). Un clic en attente sur une vanne reste tant que rien ne change.
 */
function syncValves(t: number) {
  const s = aqueducStore.getState();
  if (!s.scenario.active) return;
  const closed = isolatedAt(territoireStore.getState().actions, t) !== null;
  if (closed === s.scenario.valvesClosed) return;
  aqueducStore.setState({
    scenario: { ...s.scenario, valvesClosed: closed, valvesTurned: closed ? [...env.valves] : [] },
    ...(s.scenario.step === "isolation" ? { selection: stepSelection("isolation", territoireStore.getState().mode, closed) } : {}),
  });
}

/**
 * Reporte sur `aqueducStore.incident` l'incident de l'heure simulée `t` (par défaut, l'heure
 * courante), sans effet s'il ne change pas, pour ne pas rouvrir le flux pour rien ; pendant le
 * scénario, l'état des vannes de la coupe suit (`syncValves`) : coupe, récit, fiche et flux
 * s'accordent à toute heure.
 */
export function syncIncident(t = simNow()) {
  const inc = currentIncident(t, territoireStore.getState().actions, env.valves);
  if (incidentQuery(inc) !== incidentQuery(aqueducStore.getState().incident)) aqueducStore.setState({ incident: inc });
  syncValves(t);
}

/**
 * Branche le contrôleur sur le réseau chargé : l'incident suit l'horloge commune et les actions
 * (le passage du temps, lui, est suivi par l'appelant, qui rappelle `syncIncident`). Renvoie la
 * fonction qui le débranche.
 */
export function attachScenario(e: ScenarioEnv): () => void {
  env = e;
  syncIncident();
  const unsub = territoireStore.subscribe((s, prev) => {
    // un changement d'horloge la repart de t0 : c'est l'heure simulée de cet instant
    if (s.clock !== prev.clock) syncIncident(s.clock.t0);
    else if (s.actions !== prev.actions) syncIncident();
    // changer de mode pendant l'isolation : la coupe passe de la scène à la fiche (et inversement)
    const { scenario } = aqueducStore.getState();
    if (s.mode === prev.mode || !scenario.active || scenario.step !== "isolation") return;
    aqueducStore.setState({ selection: stepSelection("isolation", s.mode, scenario.valvesClosed) });
  });
  return () => {
    unsub();
    if (env === e) env = { valves: [] };
  };
}

