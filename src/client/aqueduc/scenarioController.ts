/**
 * Scénario de bris guidé (Simulation), sans React : testé sous Node.
 *
 * Le scénario se joue sur la journée de l'horloge commune (`territoire/store.ts`) : il la mène
 * d'étape en étape (14:01 → rapport de 20:48) et l'incident en découle (`currentIncident`), comme
 * hors scénario. Les vannes à fermer viennent du serveur (plan d'isolation du réseau,
 * `attachScenario`) ; leur fermeture passe par `closeValvesAction`, qui les valide, puis devient une
 * décision du visiteur (`act({ kind: "isolate" })`) qui reste dans la ville après le scénario.
 * « Explorer librement » rend le réseau vivant à l'heure, la vitesse, la couche et la vue (souterraine
 * ou non) quittées.
 */
import { closeValvesAction } from "@/app/aqueduc-actions";
import { CITY } from "@/lib/aqueduc/city";
import { scenarioSteps, stepAtTime, type StepId } from "@/lib/aqueduc/scenario";
import { dayStartOf } from "@/lib/territoire/day";
import { act, seek, setSpeed, simNow, territoireStore, type Mode } from "../territoire/store";
import { aqueducStore, currentIncident, incidentQuery, isolatedAt, type AqState, type Selection } from "./store";

export type { StepId };
export type CameraTarget = StepId | "start" | "exit";

export interface ScenarioEnv {
  /** nœuds des vannes qui isolent le tronçon du scénario (plan du serveur) */
  valves: number[];
  /** caméra : vue de l'étape ; « start » retient la vue du visiteur, « exit » la lui rend */
  camera?(target: CameraTarget, durationMs: number): void;
}

/**
 * Vue de chaque étape (easeTo), centrée sur le bris ou, à l'isolation, sur la coupe. Pour la coupe,
 * `bearing` est relatif au cap qui la voit de face : sur les vraies données, la corde des vannes de
 * 13C1949 suit un azimut de 34°, si bien que le cap de 55° de la maquette regarderait presque dans
 * son plan (21°) ; −18° garde une vue oblique comme la maquette C, avec les vannes, le bris et sa
 * pression dégagés des bâtiments du premier plan (vérifié à l'œil, 1440 × 860).
 */
export const STEP_VIEW: Record<StepId, { zoom: number; pitch: number; bearing: number; on: "break" | "cut" }> = {
  // vue large du secteur : la chute de pression se lit sur les conduites voisines
  detection: { zoom: 15.7, pitch: 50, bearing: -25, on: "break" },
  // vue rapprochée inclinée sur la coupe sous la rue (maquette C)
  isolation: { zoom: 18.4, pitch: 70, bearing: -18, on: "cut" },
  intervention: { zoom: 17.4, pitch: 62, bearing: 20, on: "break" },
  retablissement: { zoom: 16.3, pitch: 55, bearing: -10, on: "break" },
  rapport: { zoom: 15.5, pitch: 50, bearing: -25, on: "break" },
};

/**
 * Cap (degrés) qui voit de face la coupe entre `from` et `to` ([lng, lat]) : azimut de la corde,
 * sans sens (ramené dans [0°, 180°)), plus 90°. Le résultat ne dépend pas de l'ordre des vannes.
 */
export function faceBearing(from: readonly [number, number], to: readonly [number, number]): number {
  const kx = Math.cos((((from[1] + to[1]) / 2) * Math.PI) / 180);
  const az = (Math.atan2((to[0] - from[0]) * kx, to[1] - from[1]) * 180) / Math.PI;
  return (((az % 180) + 180) % 180) + 90;
}
export const STEP_MS = 1500;

/** Heure d'une étape dans la journée `day` (minuit local). */
const timeOf = (id: StepId, day: number) => scenarioSteps(day).find((s) => s.id === id)!.at;
/** Journée simulée à l'instant réel `now` : le scénario se joue le jour affiché par l'horloge. */
const simDay = (now: number) => dayStartOf(simNow(now));
const INCIDENT: Selection = { kind: "incident", id: CITY.breakSegment };

let env: ScenarioEnv = { valves: [] };

/**
 * Fiche ouverte d'office à une étape : à l'isolation, en mode classique, la coupe est dans la fiche
 * de l'incident ; en mode HTML-in-Canvas elle est dans la scène, et la fiche ne s'ouvre qu'une fois
 * les vannes fermées (pour en montrer l'effet).
 */
export function stepSelection(step: StepId, mode: Mode, valvesClosed: boolean): Selection {
  return step === "isolation" && (mode === "classic" || valvesClosed) ? INCIDENT : null;
}

/**
 * Reporte sur `aqueducStore.incident` l'incident de l'heure simulée `t` (par défaut, l'heure
 * courante) ; sans effet s'il ne change pas, pour ne pas rouvrir le flux pour rien.
 */
export function syncIncident(t = simNow()) {
  const inc = currentIncident(t, territoireStore.getState().actions, env.valves);
  if (incidentQuery(inc) !== incidentQuery(aqueducStore.getState().incident)) aqueducStore.setState({ incident: inc });
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

/** Retire les isolations du visiteur de la journée `day` : la séquence repart vannes ouvertes. */
function reopenValves(day: number) {
  const { actions } = territoireStore.getState();
  const kept = actions.filter((a) => a.kind !== "isolate" || dayStartOf(a.at) !== day);
  if (kept.length !== actions.length) territoireStore.setState({ actions: kept });
}

/** Applique une étape à l'heure simulée t : horloge commune (l'incident en découle), étape, fiche. */
function apply(step: StepId, t: number, now: number, patch: Partial<AqState["scenario"]> = {}, select = true) {
  seek(t, now);
  const s = aqueducStore.getState();
  const valvesClosed = isolatedAt(territoireStore.getState().actions, t) !== null;
  const scenario = { ...s.scenario, valvesClosed, ...patch, active: true, step };
  const { mode } = territoireStore.getState();
  aqueducStore.setState({ scenario, ...(select ? { selection: stepSelection(step, mode, scenario.valvesClosed) } : {}) });
}

/**
 * Lance (ou relance) le scénario à la détection (14:01) de la journée simulée, vannes ouvertes ;
 * l'heure, la vitesse, la couche et la vue quittées restent celles du premier lancement. La vue
 * souterraine est coupée : les couches, qui portent sa mention « Diamètres exagérés ×12 », sont
 * masquées pendant le scénario. Le scénario repart en temps réel (×1) : à ×60, l'horloge dépasserait
 * l'heure des étapes suivantes pendant la lecture d'une seule étape.
 */
export function startScenario(now = Date.now()) {
  const s = aqueducStore.getState();
  const { clock } = territoireStore.getState();
  const fresh = !s.scenario.active;
  const day = simDay(now);
  const resume = fresh ? { resumeAt: simNow(now), resumeSpeed: clock.speed, resumeLayer: s.layer, resumeUnderground: s.underground } : {};
  reopenValves(day);
  setSpeed(1, now);
  aqueducStore.setState({
    layer: "pression",
    underground: false,
    scenario: { ...s.scenario, valvesTurned: [], error: "", ...resume },
  });
  if (fresh) env.camera?.("start", 0);
  apply("detection", timeOf("detection", day), now);
  env.camera?.("detection", STEP_MS);
}

/** Va à une étape (horloge à son heure, incident qui en découle, caméra) ; sans effet hors scénario. */
export function goToStep(step: StepId, now = Date.now(), durationMs = STEP_MS) {
  if (!aqueducStore.getState().scenario.active) return;
  apply(step, timeOf(step, simDay(now)), now, { error: "" });
  env.camera?.(step, durationMs);
}

const offset = (k: number, now: number) => {
  const order = scenarioSteps(simDay(now)).map((s) => s.id);
  const { step } = aqueducStore.getState().scenario;
  return order[Math.min(order.length - 1, Math.max(0, order.indexOf(step) + k))];
};
export const nextStep = (now = Date.now()) => goToStep(offset(1, now), now);
export const prevStep = (now = Date.now()) => goToStep(offset(-1, now), now);

/**
 * Rend la main : réseau vivant à l'heure, la vitesse, la couche et la vue quittées ; récit, coupe et
 * fiche de l'incident démontés. L'isolation décidée pendant le scénario reste une décision du visiteur.
 */
export function exploreFreely(now = Date.now()) {
  const s = aqueducStore.getState();
  if (!s.scenario.active) return;
  territoireStore.setState({ clock: { t0: s.scenario.resumeAt ?? now, speed: s.scenario.resumeSpeed, startedAt: now } });
  aqueducStore.setState({
    layer: s.scenario.resumeLayer,
    underground: s.scenario.resumeUnderground,
    scenario: { active: false, step: "detection", valvesClosed: false, resumeAt: null, resumeSpeed: 1, resumeLayer: "pression", resumeUnderground: false, valvesTurned: [], error: "" },
    selection: s.selection?.kind === "incident" ? null : s.selection,
  });
  env.camera?.("exit", STEP_MS);
}

/**
 * Curseur de la frise : pendant le scénario, l'heure visée choisit l'étape (la caméra ne bouge pas) ;
 * sinon, simple déplacement de l'horloge. L'incident suit l'horloge dans les deux cas.
 */
export function seekTo(t: number, now = Date.now()) {
  const s = aqueducStore.getState();
  if (!s.scenario.active) return seek(t, now);
  const step = stepAtTime(t);
  apply(step, t, now, {}, step !== s.scenario.step);
}

export type CloseOutcome = { ok: true } | { ok: false; reason: string };
type CloseAction = (segmentId: string, nodes: number[]) => ReturnType<typeof closeValvesAction>;

/** Le visiteur isole le tronçon à l'heure simulée : décision datée, incident « sans eau » aussitôt. */
function isolateNow(now: number) {
  act({ kind: "isolate" }, now);
  syncIncident(simNow(now));
}

/**
 * Ferme les vannes du plan : validées par le serveur, puis isolation enregistrée à l'heure simulée de
 * la réponse (`act`), incident « sans eau » et fiche ouverte. `now` : instant de la réponse (tests).
 */
export async function closeValves(action: CloseAction = closeValvesAction, now?: number): Promise<CloseOutcome> {
  const s = aqueducStore.getState();
  if (!s.scenario.active || s.scenario.step !== "isolation") return { ok: false, reason: "Les vannes se ferment à l'étape d'isolation." };
  const fail = (reason: string): CloseOutcome => {
    const cur = aqueducStore.getState();
    aqueducStore.setState({ scenario: { ...cur.scenario, valvesTurned: [], error: reason } });
    return { ok: false, reason };
  };
  let r: Awaited<ReturnType<CloseAction>>;
  try {
    // le plan reçu du serveur, tel quel : l'action refuse toute autre liste
    r = await action(CITY.breakSegment, env.valves);
  } catch {
    return fail("La fermeture n'a pas pu être transmise au serveur. Réessayez.");
  }
  if (!r.ok) return fail(r.reason);
  const cur = aqueducStore.getState();
  // le visiteur a pu quitter l'étape pendant l'appel
  if (!cur.scenario.active || cur.scenario.step !== "isolation") return { ok: false, reason: "Étape quittée avant la réponse du serveur." };
  isolateNow(now ?? Date.now());
  aqueducStore.setState({
    scenario: { ...cur.scenario, valvesClosed: true, valvesTurned: [...r.isolation.valves], error: "" },
    selection: stepSelection("isolation", territoireStore.getState().mode, true),
  });
  return { ok: true };
}

/**
 * Clic sur une vanne de la coupe : la marque fermée (un second clic la rouvre). Quand toutes les
 * vannes du plan le sont, la fermeture part au serveur ; renvoie null tant qu'il en reste.
 */
export async function turnValve(node: number, action: CloseAction = closeValvesAction, now?: number): Promise<CloseOutcome | null> {
  const s = aqueducStore.getState();
  if (!s.scenario.active || s.scenario.step !== "isolation" || s.scenario.valvesClosed || !env.valves.includes(node)) return null;
  const turned = s.scenario.valvesTurned.includes(node) ? s.scenario.valvesTurned.filter((v) => v !== node) : [...s.scenario.valvesTurned, node];
  aqueducStore.setState({ scenario: { ...s.scenario, valvesTurned: turned, error: "" } });
  if (!env.valves.every((v) => turned.includes(v))) return null;
  return closeValves(action, now);
}

/** Séquence rejouée pendant l'export vidéo (ms depuis le début) ; « close » ferme les vannes. */
export const REPLAY: [StepId | "close", number][] = [
  ["detection", 0],
  ["isolation", 1500],
  ["close", 3600],
  ["intervention", 5200],
  ["retablissement", 6900],
  ["rapport", 8600],
];

/**
 * Rejoue les étapes en accéléré pendant l'enregistrement (`recordMap`) : la vidéo montre la
 * séquence, pas seulement le rapport. Les vannes du plan (serveur) sont fermées à l'isolation,
 * comme le fait l'équipe. Renvoie la fonction qui interrompt la lecture.
 */
export function replayForVideo(): () => void {
  const timers = REPLAY.map(([what, at]) =>
    setTimeout(() => {
      const s = aqueducStore.getState();
      if (!s.scenario.active) return;
      const now = Date.now();
      if (what === "close") {
        isolateNow(now);
        return aqueducStore.setState({ scenario: { ...s.scenario, valvesClosed: true, valvesTurned: [...env.valves] } });
      }
      // la séquence repart vannes ouvertes, même si le visiteur les a fermées avant
      if (what === "detection") {
        reopenValves(simDay(now));
        aqueducStore.setState({ scenario: { ...s.scenario, valvesTurned: [] } });
      }
      goToStep(what, now, 1100);
    }, at),
  );
  return () => timers.forEach(clearTimeout);
}
