/**
 * Accueil de l'outil de territoire : état de la ville à l'heure t (alertes, prochains événements, une
 * ligne d'état par environnement), avec ses textes déjà mis en forme. Module pur, sans React ni
 * navigateur : la page serveur le calcule à `Date.now()` sans action du visiteur, puis l'îlot client
 * le recalcule avec l'horloge et les actions du visiteur. Les textes ne dépendent que de chiffres
 * (pas des noms de jours ou de mois d'Intl), donc serveur et navigateur écrivent la même chose.
 */
import { dayIncident } from "../aqueduc/scenario";
import { allAlerts, deneigementAlerts, summarize, type Alert, type Severity } from "./alerts";
import { actionsUpTo, atHour, dayEndOf, dayStartOf, DAY_TIMES, nextEvents, TZ, type EnvAction } from "./day";
import { ENVS, type EnvFocus, type EnvId } from "./envs";
import type { Forecast } from "./meteo";
import { snowPlan, snowSource, type SnowSource } from "./neige";

export type Mode = "classic" | "hic";
/** Ton d'une ligne d'état : les trois gravités, plus « normal » et « inactif » (lot 2). */
export type Tone = Severity | "ok" | "off";
export interface EnvStatus {
  tone: Tone;
  text: string;
}

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function local(t: number) {
  const o: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const p of parts.formatToParts(t)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year!, mo: o.month!, d: o.day!, h: o.hour!, mi: o.minute! };
}

/** « 14 h 05 », heure locale de Trois-Rivières. */
export function hourLabel(t: number): string {
  const { h, mi } = local(t);
  return `${h} h ${String(mi).padStart(2, "0")}`;
}

/** « mardi 24 nov., 14 h 05 », date et heure locales. */
export function overviewStamp(t: number): string {
  const { y, mo, d } = local(t);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[mo - 1]}, ${hourLabel(t)}`;
}

/** Lien vers la vue 3D d'un environnement ; `?mode` de l'accueil est transmis à la carte. */
export function envHref(env: EnvId, mode: Mode | null = null): string {
  return mode ? `/carte/${env}?mode=${mode}` : `/carte/${env}`;
}

/**
 * Élément à mettre en avant en ouvrant une alerte : seulement s'il appartient à l'environnement de
 * l'alerte (sinon rien, pour ne pas laisser un focus qu'aucun module ne consommerait).
 */
export function alertFocus(a: Alert): EnvFocus | null {
  return a.focus && a.focus.env === a.env ? a.focus : null;
}

/** Une vanne témoin : `closedValves` non vide veut dire que le tronçon est isolé. */
const WITNESS_VALVE = [0];

/** État de l'aqueduc en une ligne : bris de 14 h du jour (non isolé, isolé, réparé) ou rien. */
export function aqueducStatus(t: number, actions: readonly EnvAction[]): EnvStatus {
  const isolates = actionsUpTo(actions, t).filter((a) => a.kind === "isolate");
  const inc = dayIncident(t, isolates.length > 0 ? isolates[isolates.length - 1].at : null, WITNESS_VALVE);
  if (!inc) return { tone: "ok", text: "Aucun bris en cours (capteurs simulés)" };
  if (inc.restoredAt !== null && t >= inc.restoredAt) return { tone: "ok", text: `Bris réparé, eau rétablie à ${hourLabel(inc.restoredAt)} (simulé)` };
  if (inc.closedValves.length > 0) return { tone: "attention", text: "1 bris isolé · réparation en cours (simulé)" };
  return { tone: "critique", text: "1 bris non isolé · Centre-ville (simulé)" };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** État du déneigement en une ligne : interdiction (à décider, décidée, en vigueur) et avancement. */
export function deneigementStatus(t: number, actions: readonly EnvAction[], source: SnowSource): EnvStatus {
  const plans = snowPlan(t, actions, source);
  const inForce = plans.filter((p) => p.ban === "en-vigueur");
  if (inForce.length > 0) {
    const progress = Math.round((inForce.reduce((s, p) => s + p.progress, 0) / inForce.length) * 100);
    return { tone: "info", text: `Interdiction en vigueur · ${plural(inForce.length, "zone", "zones")} · déneigement à ${progress} % (simulé)` };
  }
  const alert = deneigementAlerts(t, actions, source).find((a) => a.id === "neige-decision" || a.id === "neige-tard");
  if (alert?.id === "neige-tard") return { tone: "critique", text: "Trop tard pour décider l'interdiction ce soir (simulé)" };
  if (alert) return { tone: alert.severity, text: `Neige prévue · décision attendue avant ${hourLabel(atHour(dayStartOf(t), DAY_TIMES.decisionDeadline))} (simulé)` };
  const scheduled = plans.filter((p) => p.ban === "programmee");
  if (scheduled.length > 0) {
    const by = scheduled[0].decidedBy === "visiteur" ? "votre décision" : "direction, simulé";
    return { tone: "info", text: `Interdiction ce soir dès 23 h · ${plural(scheduled.length, "zone", "zones")} (${by})` };
  }
  if (t < atHour(dayStartOf(t), DAY_TIMES.forecastAt)) return { tone: "ok", text: "Aucune interdiction · prévision à 7 h 30 (simulé)" };
  return { tone: "ok", text: "Aucune interdiction ce soir (simulé)" };
}

/** Ce qui est réel et ce qui est simulé, en une ligne, pour la carte de l'accueil. */
export const ENV_REALITY: Record<EnvId, string> = {
  aqueduc: "Conduites réelles · capteurs et bris simulés",
  deneigement: "Zones réelles · feux, ressources et neige simulés",
  collecte: "Entièrement simulé (aucun jeu ouvert)",
  zonage: "Zonage réel de la Ville",
  evaluation: "Rôle d'évaluation 2026 réel, caviardé",
};

export interface HomeEnv {
  id: EnvId;
  title: string;
  blurb: string;
  reality: string;
  /** null : environnement « À venir » (lot 2), pas de lien */
  href: string | null;
  status: EnvStatus;
}

/** Les cinq environnements, dans l'ordre de `ENVS` ; seuls ceux du lot 1 ont un lien et un état. */
export function homeEnvs(t: number, actions: readonly EnvAction[], source: SnowSource, mode: Mode | null = null): HomeEnv[] {
  return (Object.keys(ENVS) as EnvId[]).map((id) => {
    const e = ENVS[id];
    const status: EnvStatus =
      id === "aqueduc" ? aqueducStatus(t, actions)
      : id === "deneigement" ? deneigementStatus(t, actions, source)
      : { tone: "off", text: "À venir" };
    return { id, title: e.title, blurb: e.blurb, reality: ENV_REALITY[id], href: e.lot === 1 ? envHref(id, mode) : null, status };
  });
}

export interface HomeAlert extends Alert {
  /** heure de l'alerte, « 14 h 01 » */
  time: string;
  href: string;
}

export interface HomeSnapshot {
  t: number;
  /** « mardi 24 nov., 14 h 05 » */
  stamp: string;
  alerts: HomeAlert[];
  summary: Record<Severity, number>;
  next: { at: number; time: string; label: string; env: EnvId; tomorrow: boolean }[];
  envs: HomeEnv[];
  snow: SnowSource;
}

/** Libellé d'un événement sans l'heure entre parenthèses (affichée à part). */
const bare = (label: string) => label.replace(/\s*\([^)]*\)$/, "");

/**
 * État de l'accueil à l'heure t : alertes triées (gravité, puis la plus récente), résumé par gravité,
 * trois prochains événements, une ligne par environnement. `forecast` null : neige simulée.
 */
export function homeSnapshot(t: number, actions: readonly EnvAction[], forecast: Forecast | null, mode: Mode | null = null): HomeSnapshot {
  const snow = snowSource(forecast);
  const alerts = allAlerts(t, actions, snow);
  const tomorrow = dayEndOf(t);
  return {
    t,
    stamp: overviewStamp(t),
    alerts: alerts.map((a) => ({ ...a, time: hourLabel(a.at), href: envHref(a.env, mode) })),
    summary: summarize(alerts),
    next: nextEvents(t, 3).map((e) => ({ ...e, time: hourLabel(e.at), label: bare(e.label), tomorrow: e.at >= tomorrow })),
    envs: homeEnvs(t, actions, snow, mode),
    snow,
  };
}

/** « 1 critique », « 2 à surveiller », « 1 info ». */
export function severityCount(s: Severity, n: number): string {
  if (s === "attention") return `${n} à surveiller`;
  if (s === "critique") return `${n} ${n > 1 ? "critiques" : "critique"}`;
  return `${n} info`;
}
