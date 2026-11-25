/**
 * Modèle du déneigement (Simulation) : source de la neige, plan d'interdiction de stationner par zone,
 * ressources et progression. Module pur, sans React ni navigateur.
 */
import { actionsUpTo, atHour, dayStartOf, DAY_TIMES, type EnvAction, type ZoneId } from "./day";
import { FLEET, type Resource } from "./fleet";
import type { Polygon } from "./geo";
import { snowTonightCm, snowWarning, SNOW_THRESHOLD_CM, type Forecast } from "./meteo";

export { FLEET, type ResourceKind } from "./fleet";

/** Zone de stationnement de nuit (réelle : Ville de Trois-Rivières, Données Québec). */
export interface Zone {
  id: ZoneId;
  name: string;
  polygon: Polygon;
}
/** Feu d'interdiction de stationnement (Simulation : emplacement le long des rues principales). */
export interface Light {
  id: string;
  zone: ZoneId;
  at: [number, number];
}
/** Réponse de `/api/territoire/deneigement`. */
export interface DeneigementData {
  zones: Zone[];
  lights: Light[];
  fleet: readonly Resource[];
}

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

/**
 * Fenêtre de décision de l'interdiction à l'instant t : « avant » jusqu'à la prévision du jour
 * (07:30 ; la nuit, ce sont les équipes qui travaillent, et aucune décision ne se prend), « ouverte »
 * de 07:30 à 15:00, « trop-tard » ensuite (les citoyens n'ont plus le temps de s'informer).
 */
export function banWindow(t: number): "avant" | "ouverte" | "trop-tard" {
  if (t < atHour(dayStartOf(t), DAY_TIMES.forecastAt)) return "avant";
  return banDeadlinePassed(t) ? "trop-tard" : "ouverte";
}

/** Décision d'interdiction du visiteur que le modèle retient : prise de jour, entre 07:30 et 15:00 (R5). */
export function isDayBan(a: EnvAction): a is Extract<EnvAction, { kind: "ban" }> {
  return a.kind === "ban" && banWindow(a.at) === "ouverte";
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
 * Entre 00:00 et 06:00, c'est l'opération de la veille (R10) : la dernière interdiction décidée par
 * le visiteur la veille, sinon la décision par défaut de la direction (10:00) ; les ressources de la
 * veille, plus les `assign` faits depuis minuit (R5). À partir de 06:00, seules les actions du jour
 * comptent. Seules les décisions de jour (07:30 à 15:00, `isDayBan`) valent : une interdiction
 * posée la nuit ne vaut pas pour le soir qui suit.
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
    // nuit : l'opération de la veille (R10). Décision du visiteur de la veille, sinon celle de la
    // direction à 10:00 ; ressources de la veille, puis les réaffectations faites depuis minuit (R5)
    const prev = dayStartOf(day - HOUR);
    const yesterday = actionsUpTo(actions, day - 1);
    const night = assignment([...yesterday, ...today]);
    const ban = yesterday.filter(isDayBan).at(-1);
    const decision = ban
      ? { by: "visiteur" as const, at: ban.at, zones: new Set<ZoneId>(ban.zones) }
      : { by: "direction" as const, at: atHour(prev, DAY_TIMES.defaultDecisionAt), zones: new Set<ZoneId>(ZONES) };
    const banStart = atHour(prev, DAY_TIMES.banStart);
    return ZONES.map((zone): ZonePlan =>
      decision.zones.has(zone)
        ? {
            zone,
            ban: "en-vigueur",
            decidedBy: decision.by,
            decidedAt: decision.at,
            resources: night[zone],
            progress: progressFrom(banStart, night[zone].length),
            lights: "allume",
          }
        : { zone, ban: "aucune", decidedBy: null, decidedAt: null, resources: night[zone], progress: 0, lights: "eteint" },
    );
  }

  const none = (zone: ZoneId): ZonePlan => ({ zone, ban: "aucune", decidedBy: null, decidedAt: null, resources: resources[zone], progress: 0, lights: "eteint" });
  if (t < atHour(day, DAY_TIMES.forecastAt)) return ZONES.map(none);

  const bans = today.filter(isDayBan);
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
