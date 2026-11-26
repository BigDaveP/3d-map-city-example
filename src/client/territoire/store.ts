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
  /** instant (horloge réelle) où `forecast` a été obtenue ; 0 tant qu'elle se charge */
  forecastAt: number;
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
    forecastAt: 0,
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

/** La prévision lue est rafraîchie au-delà de 10 minutes (le serveur la garde 30 minutes). */
export const FORECAST_TTL_MS = 10 * 60_000;
/** Délai avant un nouvel essai après un échec (« Météo indisponible »). */
export const FORECAST_RETRY_MS = 30_000;

/** Prévision connue, ou null (indisponible ou pas encore chargée). */
export const forecastOf = (s: Pick<TerritoireState, "forecast">): Forecast | null => (s.forecast === "chargement" ? null : s.forecast);

/** Range une prévision obtenue à l'instant `at` (horloge réelle). */
export function setForecast(forecast: Forecast | null, at = Date.now()) {
  territoireStore.setState({ forecast, forecastAt: at });
}

const issued = (f: Forecast) => Date.parse(f.issuedAt) || 0;

/**
 * Prévision rendue par le serveur (accueil) : elle remplace celle du store si elle est plus récente
 * (publiée plus tard), ou si le store n'a rien de mieux (chargement, indisponible). Une prévision
 * réelle déjà là n'est pas remplacée par l'échec du serveur.
 */
export function offerForecast(forecast: Forecast | null, at = Date.now()) {
  const cur = territoireStore.getState().forecast;
  if (cur === "chargement" || (forecast !== null && (cur === null || issued(forecast) > issued(cur)))) setForecast(forecast, at);
}

let forecastLoad: Promise<void> | null = null;
let forecastTriedAt = -Infinity;

/** Faut-il (re)demander la prévision à l'instant `now` ? */
export function forecastDue(now = Date.now()): boolean {
  const { forecast, forecastAt } = territoireStore.getState();
  if (forecast === "chargement") return true;
  if (now - forecastTriedAt < FORECAST_RETRY_MS) return false;
  return forecast === null ? now - forecastAt >= FORECAST_RETRY_MS : now - forecastAt >= FORECAST_TTL_MS;
}

/**
 * Prévision d'Environnement Canada (`/api/territoire/meteo`), demandée quand elle manque, quand le
 * dernier essai a échoué (après `FORECAST_RETRY_MS`) ou quand elle a plus de `FORECAST_TTL_MS` ;
 * `force` (bouton « Réessayer ») ignore ces délais. Une seule requête à la fois. Échec : null si on
 * n'avait rien (« Météo indisponible », la démo continue avec la neige simulée), sinon la prévision
 * précédente reste, réessayée plus tard.
 */
export function loadForecast({ force = false, now = Date.now() }: { force?: boolean; now?: number } = {}): Promise<void> {
  if (forecastLoad) return forecastLoad;
  if (!force && !forecastDue(now)) return Promise.resolve();
  forecastTriedAt = now;
  forecastLoad = fetch("/api/territoire/meteo", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ forecast: Forecast | null }>) : { forecast: null }))
    .then(
      (body) => body.forecast ?? null,
      () => null,
    )
    .then((forecast) => {
      if (forecast !== null || forecastOf(territoireStore.getState()) === null) setForecast(forecast, now);
    })
    .finally(() => {
      forecastLoad = null;
    });
  return forecastLoad;
}
