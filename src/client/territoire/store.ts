/**
 * État commun à toute la ville, propre à chaque visiteur (Zustand, sans React : le hook est dans
 * `useTerritoire.ts`) : une seule horloge simulée, le mode de rendu, l'état de l'API HTML-in-Canvas,
 * les décisions du visiteur (actions datées) et la prévision météo. Chaque environnement dérive son
 * état de l'heure simulée et des actions déjà posées à cette heure (`actionsUpTo`) : reculer
 * l'horloge défait donc les décisions prises plus tard, sans les oublier.
 */
import { createStore } from "zustand/vanilla";
import { actionsUpTo, type EnvAction } from "@/lib/territoire/day";
import type { EnvFocus, EnvId } from "@/lib/territoire/envs";
import type { Forecast } from "@/lib/territoire/meteo";

export type Mode = "classic" | "hic";
export type Speed = 1 | 60;
/**
 * Élément mis en avant dans un environnement (alerte choisie dans la cloche, résultat de recherche) :
 * le module de l'environnement le sélectionne, y amène la caméra, puis l'efface.
 */
export type Focus = EnvFocus | null;
/** Action sans son heure, genre par genre (`Omit` distribué sur l'union). */
export type ActionInput = EnvAction extends infer A ? (A extends EnvAction ? Omit<A, "at"> : never) : never;

export interface TerritoireState {
  /** heure simulée = t0 + (maintenant − startedAt) × speed */
  clock: { t0: number; speed: Speed; startedAt: number };
  mode: Mode;
  api: "absente" | "détectée" | "active";
  /** raison du repli en mode classique ; vide sinon */
  fallback: string;
  /** décisions du visiteur, toujours triées par heure (`at`) ; à heure égale, dans l'ordre posé */
  actions: EnvAction[];
  /** environnement affiché ; null à l'accueil */
  env: EnvId | null;
  /** prévision d'Environnement Canada ; null si indisponible */
  forecast: Forecast | null | "chargement";
  focus: Focus;
}

const initial = (): TerritoireState => {
  // on arrive sur « maintenant » : l'heure locale réelle appliquée à la journée scénarisée
  const now = Date.now();
  return {
    clock: { t0: now, speed: 1, startedAt: now },
    mode: "classic",
    api: "absente",
    fallback: "",
    actions: [],
    env: null,
    forecast: "chargement",
    focus: null,
  };
};

export const territoireStore = createStore<TerritoireState>()(initial);

/** Heure simulée courante (ms) d'après `clock`. */
export function simNow(now = Date.now(), clock = territoireStore.getState().clock): number {
  return clock.t0 + (now - clock.startedAt) * clock.speed;
}

/** Change la vitesse sans saut : l'horloge repart de l'heure simulée courante. */
export function setSpeed(speed: Speed, now = Date.now()) {
  territoireStore.setState({ clock: { t0: simNow(now), speed, startedAt: now } });
}

/** Place l'horloge simulée à t (curseur de la frise), à la même vitesse. */
export function seek(t: number, now = Date.now()) {
  const { speed } = territoireStore.getState().clock;
  territoireStore.setState({ clock: { t0: t, speed, startedAt: now } });
}

/** Revient au temps réel (×1, heure actuelle). */
export function backToNow(now = Date.now()) {
  territoireStore.setState({ clock: { t0: now, speed: 1, startedAt: now } });
}

/** Décision du visiteur, datée à l'heure simulée ; rangée après les actions de même heure ou plus tôt. */
export function act(a: ActionInput, now = Date.now()): EnvAction {
  const done = { ...a, at: simNow(now) } as EnvAction;
  const { actions } = territoireStore.getState();
  const i = actions.findLastIndex((x) => x.at <= done.at) + 1;
  territoireStore.setState({ actions: [...actions.slice(0, i), done, ...actions.slice(i)] });
  return done;
}

/**
 * Annule la dernière décision de ce genre déjà posée à l'heure simulée (une décision « future »,
 * laissée par un retour en arrière, n'est pas visible et reste). Renvoie l'action retirée, ou null.
 */
export function undoLast(kind: EnvAction["kind"], now = Date.now()): EnvAction | null {
  const { actions } = territoireStore.getState();
  const last = actionsUpTo(actions, simNow(now)).findLast((a) => a.kind === kind);
  if (!last) return null;
  territoireStore.setState({ actions: actions.filter((a) => a !== last) });
  return last;
}

/** Repli de HicHost (aucun pixel transmis, API absente…) : la scène passe en mode classique. */
export function hicFallback(reason: string) {
  territoireStore.setState({ mode: "classic", fallback: `Mode classique activé automatiquement : ${reason}` });
}

/** Vérification `readPixels` réussie : l'API HTML-in-Canvas est active. */
export function hicActive() {
  if (territoireStore.getState().api !== "active") territoireStore.setState({ api: "active" });
}

export function setFocus(focus: Focus) {
  territoireStore.setState({ focus });
}

let forecastLoad: Promise<void> | null = null;

/**
 * Prévision d'Environnement Canada (`/api/territoire/meteo`), chargée une fois par page si personne
 * ne l'a encore fournie (l'accueil la donne déjà, rendue par le serveur). Échec : null, la démo
 * continue avec la neige simulée.
 */
export function loadForecast(): Promise<void> {
  if (territoireStore.getState().forecast !== "chargement") return Promise.resolve();
  forecastLoad ??= fetch("/api/territoire/meteo")
    .then((r) => (r.ok ? (r.json() as Promise<{ forecast: Forecast | null }>) : { forecast: null }))
    .then(
      (body) => body.forecast ?? null,
      () => null,
    )
    .then((forecast) => {
      if (territoireStore.getState().forecast === "chargement") territoireStore.setState({ forecast });
    });
  return forecastLoad;
}
