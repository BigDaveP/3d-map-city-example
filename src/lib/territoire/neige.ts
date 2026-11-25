/**
 * Modèle du déneigement (Simulation) : source de la neige, plan d'interdiction de stationner par zone,
 * ressources et progression. Module pur, sans React ni navigateur.
 */
import { actionsUpTo, atHour, dayStartOf, DAY_TIMES, type EnvAction, type ZoneId } from "./day";
import { FLEET } from "./fleet";
import { snowTonightCm, snowWarning, SNOW_THRESHOLD_CM, type Forecast } from "./meteo";

export { FLEET, type ResourceKind } from "./fleet";

const HOUR = 3_600_000;
export const ZONES: readonly ZoneId[] = ["A", "B", "C"];

export type SnowSource = { kind: "eccc"; cm: number; label: string } | { kind: "simulation"; cm: 12 };

export const ECCC_LABEL = "prévision Environnement Canada";

/** Neige de la prévision si elle atteint le seuil ou s'il y a un avertissement de neige ; sinon simulation. */
export function snowSource(f: Forecast | null): SnowSource {
  if (f) {
    const cm = snowTonightCm(f);
    if (cm >= SNOW_THRESHOLD_CM || snowWarning(f) !== null) return { kind: "eccc", cm: Math.round(cm * 10) / 10, label: ECCC_LABEL };
  }
  return { kind: "simulation", cm: 12 };
}

export interface ZonePlan {
  zone: ZoneId;
  ban: "aucune" | "programmee" | "en-vigueur";
  decidedBy: "visiteur" | "direction" | null;
  decidedAt: number | null;
  resources: string[];
  progress: number;
  lights: "eteint" | "programme" | "allume";
}

/** Une opération de déneigement d'une zone dure 6,5 h pour 8 ressources ; elle s'allonge avec moins de ressources. */
const CREW_HOURS = 6.5 * 8;

/** Les `ban` du visiteur après 15:00 sont ignorés par le modèle (l'interface les refuse avant). */
export function banDeadlinePassed(t: number): boolean {
  return t > atHour(dayStartOf(t), DAY_TIMES.decisionDeadline);
}

/** Ressources par zone : répartition circulaire dans l'ordre de FLEET, puis les `assign` du visiteur. */
function assignment(actions: readonly EnvAction[]): Record<ZoneId, string[]> {
  const zoneOf = new Map<string, ZoneId | null>(FLEET.map((r, i) => [r.id, ZONES[i % ZONES.length]]));
  for (const a of actions) if (a.kind === "assign" && zoneOf.has(a.resource)) zoneOf.set(a.resource, a.zone);
  const out: Record<ZoneId, string[]> = { A: [], B: [], C: [] };
  for (const r of FLEET) {
    const z = zoneOf.get(r.id);
    if (z) out[z].push(r.id);
  }
  return out;
}

/**
 * Plan par zone à l'instant t (actions de la journée de t seulement).
 * Entre 00:00 et 06:00, c'est le plan par défaut de la veille : les `ban` du visiteur ne comptent pas
 * (ils repartent à minuit), mais les `assign` faits depuis minuit s'appliquent aux ressources.
 */
export function snowPlan(t: number, actions: readonly EnvAction[], _source: SnowSource): ZonePlan[] {
  const day = dayStartOf(t);
  const today = actionsUpTo(actions, t);
  const resources = assignment(today);
  const progressFrom = (banStart: number, n: number) => {
    if (t < banStart) return 0;
    return Math.min(1, (t - banStart) / ((CREW_HOURS / Math.max(1, n)) * HOUR));
  };

  if (t < atHour(day, DAY_TIMES.banEnd)) {
    const prev = dayStartOf(day - HOUR);
    const decidedAt = atHour(prev, DAY_TIMES.defaultDecisionAt);
    const banStart = atHour(prev, DAY_TIMES.banStart);
    return ZONES.map((zone) => ({
      zone,
      ban: "en-vigueur",
      decidedBy: "direction",
      decidedAt,
      resources: resources[zone],
      progress: progressFrom(banStart, resources[zone].length),
      lights: "allume",
    }));
  }

  const none = (zone: ZoneId): ZonePlan => ({ zone, ban: "aucune", decidedBy: null, decidedAt: null, resources: resources[zone], progress: 0, lights: "eteint" });
  if (t < atHour(day, DAY_TIMES.forecastAt)) return ZONES.map(none);

  const deadline = atHour(day, DAY_TIMES.decisionDeadline);
  const bans = today.filter((a): a is Extract<EnvAction, { kind: "ban" }> => a.kind === "ban" && a.at <= deadline);
  const visitor = bans.length > 0 ? bans[bans.length - 1] : null;
  const defaultAt = atHour(day, DAY_TIMES.defaultDecisionAt);
  const decision =
    visitor !== null
      ? { by: "visiteur" as const, at: visitor.at, zones: new Set<ZoneId>(visitor.zones) }
      : t >= defaultAt
        ? { by: "direction" as const, at: defaultAt, zones: new Set<ZoneId>(ZONES) }
        : null;
  if (decision === null) return ZONES.map(none);

  const banStart = atHour(day, DAY_TIMES.banStart);
  return ZONES.map((zone) => {
    if (!decision.zones.has(zone)) return none(zone);
    const inForce = t >= banStart;
    return {
      zone,
      ban: inForce ? "en-vigueur" : "programmee",
      decidedBy: decision.by,
      decidedAt: decision.at,
      resources: resources[zone],
      progress: progressFrom(banStart, resources[zone].length),
      lights: inForce ? "allume" : "programme",
    };
  });
}
