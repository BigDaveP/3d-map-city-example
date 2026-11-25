/**
 * Journée locale de la démo (America/Toronto) : minuit local, heures de la journée scénarisée et
 * actions datées. Module pur, sans React ni navigateur.
 */
import type { EnvId } from "./envs";

export const TZ = "America/Toronto";

export type ZoneId = "A" | "B" | "C";

const HOUR = 3_600_000;

/** Heures locales de la journée scénarisée (spec 5.2). */
export const DAY_TIMES = {
  banEnd: "06:00",
  collecteStart: "07:00",
  forecastAt: "07:30",
  defaultDecisionAt: "10:00",
  decisionCritical: "12:00",
  breakAt: "14:00",
  decisionDeadline: "15:00",
  snowStart: "19:00",
  banStart: "23:00",
} as const;

export type EnvAction =
  | { at: number; kind: "ban"; zones: ZoneId[] }
  | { at: number; kind: "assign"; resource: string; zone: ZoneId | null }
  | { at: number; kind: "isolate" };

const fields = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

interface Local {
  y: number;
  mo: number;
  d: number;
}

/** Date locale (année, mois 1-12, jour) de l'instant t. */
function localDate(t: number): Local {
  const o: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const p of fields.formatToParts(t)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year!, mo: o.month!, d: o.day! };
}

/** Écart (ms) entre l'heure locale et UTC à l'instant t : −5 h ou −4 h. */
function offsetAt(t: number): number {
  const o: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const p of fields.formatToParts(t)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return Date.UTC(o.year!, o.month! - 1, o.day!, o.hour!, o.minute!, o.second!) - Math.floor(t / 1000) * 1000;
}

/** Instant UTC d'une heure locale donnée ; deux passes pour tenir compte du changement d'heure. */
function localToUtc(l: Local, h: number, mi: number): number {
  const naive = Date.UTC(l.y, l.mo - 1, l.d, h, mi);
  return naive - offsetAt(naive - offsetAt(naive));
}

/** Minuit local de la journée qui contient t (une journée dure 23 h ou 25 h au changement d'heure). */
export function dayStartOf(t: number): number {
  return localToUtc(localDate(t), 0, 0);
}

/** `day` (minuit local) plus une heure locale « HH:MM », sans erreur au changement d'heure. */
export function atHour(day: number, hhmm: string): number {
  const [h, mi] = hhmm.split(":").map(Number);
  return localToUtc(localDate(day), h, mi);
}

/** Actions de la journée de t, déjà posées à t : écarte la veille et le futur (retour en arrière, minuit). */
export function actionsUpTo(actions: readonly EnvAction[], t: number): EnvAction[] {
  const day = dayStartOf(t);
  return actions.filter((a) => a.at <= t && dayStartOf(a.at) === day);
}

const EVENTS: { time: keyof typeof DAY_TIMES; label: string; env: EnvId }[] = [
  { time: "banEnd", label: "Levée automatique de l'interdiction (6 h)", env: "deneigement" },
  { time: "collecteStart", label: "Début de la collecte (7 h)", env: "collecte" },
  { time: "forecastAt", label: "Prévision de neige pour ce soir (7 h 30)", env: "deneigement" },
  { time: "defaultDecisionAt", label: "Décision par défaut de l'interdiction (10 h)", env: "deneigement" },
  { time: "breakAt", label: "Bris de conduite au centre-ville (14 h)", env: "aqueduc" },
  { time: "decisionDeadline", label: "Limite de décision pour ce soir (15 h)", env: "deneigement" },
  { time: "snowStart", label: "Début de la neige (19 h)", env: "deneigement" },
  { time: "banStart", label: "Interdiction en vigueur (23 h)", env: "deneigement" },
];

/** Les n prochains événements scénarisés après t (aujourd'hui, puis demain). */
export function nextEvents(t: number, n: number): { at: number; label: string; env: EnvId }[] {
  const today = dayStartOf(t);
  const tomorrow = dayStartOf(today + 36 * HOUR);
  return [today, tomorrow]
    .flatMap((day) => EVENTS.map((e) => ({ at: atHour(day, DAY_TIMES[e.time]), label: e.label, env: e.env })))
    .filter((e) => e.at > t)
    .sort((a, b) => a.at - b.at)
    .slice(0, n);
}

