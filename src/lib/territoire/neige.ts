/**
 * Modèle du déneigement (Simulation) : source de la neige, plan d'interdiction de stationner par zone,
 * ressources et progression. Module pur, sans React ni navigateur.
 */
import { atHour, dayStartOf, DAY_TIMES, type EnvAction, type ZoneId } from "./day";
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

/** Décision d'interdiction du visiteur (toujours acceptée, R11). */
export type BanAction = Extract<EnvAction, { kind: "ban" }>;

export const isBan = (a: EnvAction): a is BanAction => a.kind === "ban";

/**
 * Journée d'opération de l'instant t : minuit du jour dont la soirée et la nuit sont en jeu. Une
 * opération va de 06:00 (levée de la nuit précédente) à 06:00 le lendemain ; entre 00:00 et 06:00,
 * c'est donc l'opération de la veille (R10).
 */
export function operationDayOf(t: number): number {
  const day = dayStartOf(t);
  return t < atHour(day, DAY_TIMES.banEnd) ? dayStartOf(day - HOUR) : day;
}

/**
 * Moment d'une décision prise à l'instant t (R11 : jamais refusée, seulement expliquée) :
 * « avant-prevision » de 06:00 à 07:30 (la prévision du jour n'est pas encore là), « jour » jusqu'à
 * 15:00, « tardive » de 15:00 à 23:00 (les résidents ont moins de temps pour déplacer leur véhicule),
 * « nuit » de 23:00 à 06:00 (la décision change la nuit en cours, tout de suite).
 */
export function banTiming(t: number): "avant-prevision" | "jour" | "tardive" | "nuit" {
  const op = operationDayOf(t);
  if (t >= atHour(op, DAY_TIMES.banStart)) return "nuit";
  if (t < atHour(op, DAY_TIMES.forecastAt)) return "avant-prevision";
  return t > atHour(op, DAY_TIMES.decisionDeadline) ? "tardive" : "jour";
}

/** Décision d'interdiction : qui, quand, quelles zones (vide : aucune interdiction). */
export interface BanDecision {
  by: "visiteur" | "direction";
  at: number;
  zones: ZoneId[];
}

/**
 * Décisions successives de l'opération de t, jusqu'à t : la décision par défaut de la direction à
 * 10:00 (seulement si le visiteur n'a rien décidé avant), puis chaque décision du visiteur, à toute
 * heure de l'opération (de 06:00 à 06:00, R10 et R11).
 */
function decisions(t: number, actions: readonly EnvAction[]): BanDecision[] {
  const op = operationDayOf(t);
  const bans = actions.filter((a): a is BanAction => isBan(a) && a.at <= t && operationDayOf(a.at) === op);
  const defaultAt = atHour(op, DAY_TIMES.defaultDecisionAt);
  const out: BanDecision[] = [];
  if (t >= defaultAt && !(bans.length > 0 && bans[0].at < defaultAt)) out.push({ by: "direction", at: defaultAt, zones: [...ZONES] });
  for (const b of bans) out.push({ by: "visiteur", at: b.at, zones: ZONES.filter((z) => b.zones.includes(z)) });
  return out.sort((a, b) => a.at - b.at);
}

/** Décision en vigueur pour l'opération de t (dernière décision du visiteur, sinon celle de la direction), ou null. */
export function banDecision(t: number, actions: readonly EnvAction[]): BanDecision | null {
  return decisions(t, actions).at(-1) ?? null;
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
 * Plan par zone à l'instant t, pour l'opération en cours (de 06:00 à 06:00, `operationDayOf`).
 * Avant 23:00, la décision en vigueur programme l'interdiction du soir ; de 23:00 à 06:00, elle est
 * en vigueur, et une décision prise pendant la nuit la change tout de suite (R11) : les feux suivent,
 * et le déneigement d'une zone ajoutée commence à l'heure de la décision. Ressources : les `assign`
 * de l'opération en cours, depuis 06:00 ; ceux faits la nuit valent pour la nuit, pas pour la journée
 * qui suit (R5, R10).
 */
export function snowPlan(t: number, actions: readonly EnvAction[], _source: SnowSource): ZonePlan[] {
  const op = operationDayOf(t);
  // comme les décisions : seules les réaffectations de l'opération en cours (de 06:00 à 06:00, R10)
  const resources = assignment(actions.filter((a) => a.kind === "assign" && a.at <= t && operationDayOf(a.at) === op));
  const banStart = atHour(op, DAY_TIMES.banStart);
  const inForce = t >= banStart;
  const all = decisions(t, actions);
  const current = all.at(-1);

  return ZONES.map((zone): ZonePlan => {
    if (!current || !current.zones.includes(zone)) {
      return { zone, ban: "aucune", decidedBy: null, decidedAt: null, resources: resources[zone], progress: 0, lights: "eteint" };
    }
    // interdite sans interruption depuis `since` : le déneigement part de 23:00 ou de ce moment
    let since = current.at;
    for (let i = all.length - 1; i >= 0 && all[i].zones.includes(zone); i--) since = all[i].at;
    const start = Math.max(banStart, since);
    const n = resources[zone].length;
    return {
      zone,
      ban: inForce ? "en-vigueur" : "programmee",
      decidedBy: current.by,
      decidedAt: current.at,
      resources: resources[zone],
      progress: inForce ? Math.min(1, (t - start) / ((CREW_HOURS / Math.max(1, n)) * HOUR)) : 0,
      lights: inForce ? "allume" : "programme",
    };
  });
}
