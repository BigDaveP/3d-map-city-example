/**
 * État client de la démo réseau d'eau, propre à chaque visiteur (Zustand, sans React : le hook est
 * dans `useAq.ts`). L'horloge, le mode et les décisions du visiteur sont communs à la ville
 * (`territoire/store.ts`) ; l'incident en découle (`currentIncident`) : un onglet masqué ou un flux
 * coupé reprend juste, car l'état du réseau ne dépend que de l'heure simulée et des actions.
 */
import { createStore } from "zustand/vanilla";
import type { SectorStat } from "@/lib/aqueduc/sim";
import { dayIncident, type StepId } from "@/lib/aqueduc/scenario";
import { actionsUpTo, type EnvAction } from "@/lib/territoire/day";
import type { Speed } from "../territoire/store";
// type seulement : le module serveur n'est jamais importé côté client
import type { Notice } from "@/server/aqueduc";

export type { Notice };
export type LayerId = "pression" | "qualite" | "age" | "rincage" | "incidents";
export type Selection = { kind: "segment" | "sensor" | "sector" | "incident"; id: string } | null;

/** Incident transmis au flux (toujours sur CITY.breakSegment). */
export interface IncidentParams {
  /** ms sim */
  startedAt: number;
  closedValves: number[];
  restoredAt: number | null;
}

export interface AqState {
  layer: LayerId;
  underground: boolean;
  undergroundAll: boolean;
  selection: Selection;
  /**
   * Scénario guidé (piloté par `scenarioController.ts`) : il mène l'horloge commune d'étape en étape.
   * `valvesClosed` : le visiteur a isolé le tronçon (action déjà posée à l'heure de l'étape).
   * `resumeAt`, `resumeSpeed`, `resumeLayer`, `resumeUnderground` :
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
  /**
   * Incident à l'heure simulée pour le flux SSE et les courbes, dérivé de l'horloge commune et des
   * actions (`currentIncident`, tenu à jour par `syncIncident`) ; null avant le bris de 14:00.
   */
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
  /** vue souterraine indisponible (shaders des tubes refusés par le pilote) ; vide si tout va bien */
  undergroundError: string;
}

const initial = (): AqState => ({
  layer: "pression",
  underground: false,
  undergroundAll: false,
  selection: null,
  scenario: { active: false, step: "detection", valvesClosed: false, resumeAt: null, resumeSpeed: 1, resumeLayer: "pression", resumeUnderground: false, valvesTurned: [], error: "" },
  incident: null,
  live: { t: 0, readings: [], pressure: new Float32Array(0), chlorine: new Float32Array(0), sectors: [], extra: [], receivedAt: 0 },
  notices: [],
  benchTags: null,
  undergroundError: "",
});

export const aqueducStore = createStore<AqState>()(initial);

/** Heure de la dernière isolation (`isolate`) du visiteur déjà posée à t, dans la journée de t ; null sinon. */
export function isolatedAt(actions: readonly EnvAction[], t: number): number | null {
  return actionsUpTo(actions, t).findLast((a) => a.kind === "isolate")?.at ?? null;
}

/** Incident de l'aqueduc à l'heure t : bris de 14:00, vannes fermées par le visiteur ou par l'équipe. */
export function currentIncident(t: number, actions: readonly EnvAction[], valves: readonly number[]): IncidentParams | null {
  return dayIncident(t, isolatedAt(actions, t), valves);
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
