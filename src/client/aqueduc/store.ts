/**
 * État client de la démo réseau d'eau, propre à chaque visiteur (Zustand, sans React : le hook est
 * dans `useAq.ts`). L'horloge simulée se déduit de `clock` à tout instant : un onglet masqué ou un flux
 * coupé reprend juste, car l'état du réseau ne dépend que de l'heure simulée.
 */
import { createStore } from "zustand/vanilla";
import type { SectorStat } from "@/lib/aqueduc/sim";
import type { StepId } from "@/lib/aqueduc/scenario";
// type seulement : le module serveur n'est jamais importé côté client
import type { Notice } from "@/server/aqueduc";

export type { Notice };
export type LayerId = "pression" | "qualite" | "age" | "rincage" | "incidents";
export type Selection = { kind: "segment" | "sensor" | "sector" | "incident"; id: string } | null;
export type Mode = "classic" | "hic";
export type Speed = 1 | 60;

/** Incident transmis au flux (toujours sur CITY.breakSegment) ; rempli par le scénario. */
export interface IncidentParams {
  /** ms sim */
  startedAt: number;
  closedValves: number[];
  restoredAt: number | null;
}

export interface AqState {
  mode: Mode;
  layer: LayerId;
  underground: boolean;
  undergroundAll: boolean;
  selection: Selection;
  clock: { t0: number; speed: Speed; startedAt: number };
  /**
   * Scénario guidé (piloté par `scenarioController.ts`) : il remplace l'horloge vivante et fixe
   * `incident` à chaque étape. `resumeAt`, `resumeSpeed`, `resumeLayer`, `resumeUnderground` :
   * réseau vivant quitté (la vue souterraine est coupée pendant le scénario : les couches, qui portent
   * sa mention, sont masquées).
   * `valvesTurned` : vannes manœuvrées dans la coupe, en attente de la confirmation du serveur.
   */
  scenario: {
    active: boolean;
    step: StepId;
    valvesClosed: boolean;
    resumeAt: number | null;
    resumeSpeed: Speed;
    resumeLayer: LayerId;
    resumeUnderground: boolean;
    valvesTurned: number[];
    error: string;
  };
  /** incident en cours pour le flux SSE et les courbes ; null en exploration libre */
  incident: IncidentParams | null;
  live: {
    /** heure simulée de la dernière lecture (0 : rien reçu) */
    t: number;
    /** [valeur, statut 0|1|2] par capteur (ordre de `sensors`) */
    readings: [number, number][];
    /** pression et chlore des segments de `demoSegments` */
    pressure: Float32Array;
    chlorine: Float32Array;
    sectors: SectorStat[];
    /** [valeur, statut] des points supplémentaires du banc (vide hors banc) */
    extra: [number, number][];
    /** instant (performance.now) de réception du message : latence lecture → pixel */
    receivedAt: number;
  };
  notices: Notice[];
  /**
   * Banc de mesures seulement (`window.__aqueduc.setTags(n)`, R7) : n étiquettes, capteurs réels de la
   * zone d'abord puis points supplémentaires simulés, sans le filtre de pertinence ni le plafond de 8
   * (R13). null : usage normal.
   */
  benchTags: number | null;
  api: "absente" | "détectée" | "active";
  fallback: string;
  /** vue souterraine indisponible (shaders des tubes refusés par le pilote) ; vide si tout va bien */
  undergroundError: string;
}

const initial = (): AqState => ({
  mode: "classic",
  layer: "pression",
  underground: false,
  undergroundAll: false,
  selection: null,
  clock: { t0: Date.now(), speed: 1, startedAt: Date.now() },
  scenario: { active: false, step: "detection", valvesClosed: false, resumeAt: null, resumeSpeed: 1, resumeLayer: "pression", resumeUnderground: false, valvesTurned: [], error: "" },
  incident: null,
  live: { t: 0, readings: [], pressure: new Float32Array(0), chlorine: new Float32Array(0), sectors: [], extra: [], receivedAt: 0 },
  notices: [],
  benchTags: null,
  api: "absente",
  fallback: "",
  undergroundError: "",
});

export const aqueducStore = createStore<AqState>()(initial);

/** Heure simulée courante (ms) d'après `clock`. */
export function simNow(now = Date.now(), clock = aqueducStore.getState().clock): number {
  return clock.t0 + (now - clock.startedAt) * clock.speed;
}

/** Change la vitesse sans saut : l'horloge repart de l'heure simulée courante. */
export function setSpeed(speed: Speed, now = Date.now()) {
  const t0 = simNow(now);
  aqueducStore.setState({ clock: { t0, speed, startedAt: now } });
}

/** Place l'horloge simulée à t (curseur de la frise), à la même vitesse. */
export function seek(t: number, now = Date.now()) {
  const { speed } = aqueducStore.getState().clock;
  aqueducStore.setState({ clock: { t0: t, speed, startedAt: now } });
}

/** Revient au temps réel (×1, heure actuelle). */
export function backToNow(now = Date.now()) {
  aqueducStore.setState({ clock: { t0: now, speed: 1, startedAt: now } });
}

export function select(selection: Selection) {
  aqueducStore.setState({ selection });
}

/** Clé de sélection pour les requêtes (« sensor:P-01 ») ; vide sans sélection. */
export const selectionKey = (s: Selection) => (s ? `${s.kind}:${s.id}` : "");

/** Paramètres d'incident du flux et des courbes (`inc`, `closed`, `restored`). */
export function incidentQuery(inc: IncidentParams | null): string {
  if (!inc) return "";
  const q = new URLSearchParams({ inc: String(inc.startedAt) });
  if (inc.closedValves.length) q.set("closed", inc.closedValves.join(","));
  if (inc.restoredAt !== null) q.set("restored", String(inc.restoredAt));
  return q.toString();
}

/** Ajoute un avis publié ; republier le même avis ne le duplique pas. */
export function addNotice(n: Notice) {
  const { notices } = aqueducStore.getState();
  if (notices.some((x) => x.sectorId === n.sectorId && x.kind === n.kind)) return;
  aqueducStore.setState({ notices: [...notices, n] });
}
