/** Alertes de la ville (Simulation) : déneigement et aqueduc, déduites de l'heure et des actions. Module pur. */
import { scenarioSteps } from "../aqueduc/scenario";
import { actionsUpTo, atHour, dayStartOf, DAY_TIMES, type EnvAction } from "./day";
import type { EnvFocus, EnvId } from "./envs";
import { isDayBan, snowPlan, type SnowSource } from "./neige";

export type Severity = "critique" | "attention" | "info";
export interface Alert {
  id: string;
  env: EnvId;
  severity: Severity;
  title: string;
  detail: string;
  at: number;
  focus?: EnvFocus;
}

const HOUR = 3_600_000;
const BREAK_ID = "13C1949";

function snowDetail(s: SnowSource): string {
  return s.kind === "eccc" ? `${s.cm} cm dans les prochaines 36 h (${s.label})` : `${s.cm} cm dans les prochaines 36 h (Simulation)`;
}

/**
 * Alertes du déneigement ; `defaultDecision` dit si la direction décide à 10:00 quand le visiteur ne le
 * fait pas. Avec elle (cas de la démo), les alertes « critique » de 12:00 et « trop tard » de 15:00 ne
 * se déclenchent jamais : elles restent dans le modèle pour le cas sans décision par défaut.
 */
export function deneigementAlertsWith(t: number, actions: readonly EnvAction[], source: SnowSource, defaultDecision: boolean): Alert[] {
  const day = dayStartOf(t);
  const time = (k: keyof typeof DAY_TIMES) => atHour(day, DAY_TIMES[k]);
  const out: Alert[] = [];
  const plan = snowPlan(t, actions, source);
  const inForce = plan.filter((p) => p.ban === "en-vigueur").length;

  if (t < time("banEnd")) {
    if (inForce > 0) out.push(inForceAlert(inForce, atHour(dayStartOf(day - HOUR), DAY_TIMES.banStart)));
    return out;
  }
  if (t < time("forecastAt")) return out;

  const deadline = time("decisionDeadline");
  const visitorBan = actionsUpTo(actions, t).some(isDayBan);
  const decided = visitorBan || (defaultDecision && t >= time("defaultDecisionAt"));

  if (!decided) {
    if (t >= deadline) {
      out.push({ id: "neige-tard", env: "deneigement", severity: "critique", title: "Trop tard pour ce soir", detail: `Aucune interdiction décidée avant 15 h. ${snowDetail(source)}.`, at: deadline });
    } else {
      const critical = t >= time("decisionCritical");
      out.push({
        id: "neige-decision",
        env: "deneigement",
        severity: critical ? "critique" : "attention",
        title: "Neige prévue ce soir — décider l'interdiction de stationner",
        detail: `${snowDetail(source)}. Décision attendue avant 15 h.`,
        at: critical ? time("decisionCritical") : time("forecastAt"),
      });
    }
  }
  if (inForce > 0) out.push(inForceAlert(inForce, time("banStart")));
  return out;
}

function inForceAlert(n: number, at: number): Alert {
  return { id: "neige-vigueur", env: "deneigement", severity: "info", title: `Interdiction en vigueur dans ${n} ${n > 1 ? "zones" : "zone"}`, detail: "Interdiction de stationner la nuit, de 23 h à 6 h (Simulation).", at };
}

export function deneigementAlerts(t: number, actions: readonly EnvAction[], source: SnowSource): Alert[] {
  return deneigementAlertsWith(t, actions, source, true);
}

/** Alertes du bris de conduite : critique jusqu'à l'isolation (visiteur ou intervention), puis réparation. */
export function aqueducAlerts(t: number, actions: readonly EnvAction[]): Alert[] {
  const steps = scenarioSteps(dayStartOf(t));
  const step = (id: string) => steps.find((s) => s.id === id)!.at;
  const detection = step("detection");
  const restored = step("retablissement");
  if (t < detection || t >= restored) return [];
  const isolates = actionsUpTo(actions, t).filter((a) => a.kind === "isolate");
  const isolatedAt = Math.min(isolates.length > 0 ? isolates[isolates.length - 1].at : Infinity, step("intervention"));
  const focus: EnvFocus = { env: "aqueduc", kind: "incident", id: BREAK_ID };
  if (t < isolatedAt) {
    return [{ id: "aqueduc-bris", env: "aqueduc", severity: "critique", title: `Bris de conduite ${BREAK_ID} · Centre-ville`, detail: "Chute de pression détectée par le capteur P-01 (Simulation) ; le tronçon n'est pas isolé.", at: detection, focus }];
  }
  return [{ id: "aqueduc-reparation", env: "aqueduc", severity: "attention", title: "Réparation en cours", detail: "Tronçon isolé, réparation de la conduite 13C1949 (Simulation).", at: isolatedAt, focus }];
}

const RANK: Record<Severity, number> = { critique: 0, attention: 1, info: 2 };

/** Gravité d'abord (critique, attention, info), puis la plus récente. */
export function sortAlerts(a: readonly Alert[]): Alert[] {
  return [...a].sort((x, y) => RANK[x.severity] - RANK[y.severity] || y.at - x.at);
}

export function allAlerts(t: number, actions: readonly EnvAction[], source: SnowSource): Alert[] {
  return sortAlerts([...deneigementAlerts(t, actions, source), ...aqueducAlerts(t, actions)]);
}

export function summarize(a: readonly Alert[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critique: 0, attention: 0, info: 0 };
  for (const x of a) out[x.severity]++;
  return out;
}
