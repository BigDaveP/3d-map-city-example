/**
 * Libellés et formats de la démo réseau d'eau (français, heure de l'Est). Module pur : utilisable
 * par la page serveur, les routes, le client et les tests (aucun import React ni navigateur).
 */
import type { Material, PipeClass } from "@/lib/aqueduc/network";
import type { SectorStat, SensorKind } from "@/lib/aqueduc/sim";
import { dayStartOf } from "@/lib/territoire/day";

export const TIME_ZONE = "America/Toronto";

/** Débit de nuit au-delà duquel une fuite est probable (rapport au débit attendu). */
export const NIGHT_RATIO_WARN = 1.1;

export const MATERIAL: Record<Material, string> = {
  "fonte-grise": "Fonte grise",
  "fonte-ductile": "Fonte ductile",
  pvc: "PVC",
  pehd: "PEHD",
  "ciment-amiante": "Amiante-ciment",
  autre: "Autre",
};

export const PIPE_CLASS: Record<PipeClass, string> = {
  amenee: "Conduite d'amenée",
  maitresse: "Conduite maîtresse",
  distribution: "Conduite de distribution",
  branchement: "Branchement",
};

export const SENSOR_KIND: Record<SensorKind, { name: string; measure: string; threshold: string }> = {
  pression: { name: "Capteur de pression", measure: "Pression", threshold: "≥ 2,0 bar (attention sous 2,5 bar)" },
  debit: { name: "Débitmètre", measure: "Débit", threshold: "± 25 % du débit attendu" },
  qualite: { name: "Station de qualité", measure: "Chlore résiduel", threshold: "0,2 à 4,0 mg/L" },
  reservoir: { name: "Sonde de réservoir", measure: "Niveau", threshold: "≥ 30 % (attention sous 50 %)" },
};

export const STATUS_LABEL = ["Normal", "Attention", "Alerte"] as const;

const nf = new Map<number, Intl.NumberFormat>();
/** Nombre en français (virgule décimale, espace des milliers). */
export function num(x: number, digits = 0): string {
  let f = nf.get(digits);
  if (!f) nf.set(digits, (f = new Intl.NumberFormat("fr-CA", { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(x);
}

/** Valeur d'un capteur avec son unité, deux chiffres significatifs utiles. */
export function sensorValue(kind: SensorKind, v: number): string {
  if (kind === "pression") return `${num(v, 1)} bar`;
  if (kind === "debit") return `${num(v, v < 100 ? 1 : 0)} L/s`;
  if (kind === "qualite") return `${num(v, 2)} mg/L`;
  return `${num(v, 0)} %`;
}

const hm = new Intl.DateTimeFormat("fr-CA", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFmt = new Intl.DateTimeFormat("fr-CA", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });

/** « 07:42 » à l'heure de l'Est. */
export function clockTime(t: number): string {
  return hm.format(t).replace(" h ", ":");
}

/** « mar. 24 nov. » à l'heure de l'Est. */
export function clockDay(t: number): string {
  return dayFmt.format(t);
}

/** Minuit local (heure de l'Est) de la journée qui contient t, à la minute près. */
export const dayStart = dayStartOf;

/** Statut d'un secteur : 2 si un capteur y est en alerte, 1 si le débit de nuit est élevé (fuite probable), sinon 0. */
export function sectorStatus(stat: Pick<SectorStat, "nightRatio">, alerts: number): { level: 0 | 1 | 2; label: string } {
  if (alerts > 0) return { level: 2, label: alerts > 1 ? `${alerts} capteurs en alerte` : "1 capteur en alerte" };
  if (stat.nightRatio >= NIGHT_RATIO_WARN) return { level: 1, label: `Débit de nuit élevé (+${num((stat.nightRatio - 1) * 100)} %)` };
  return { level: 0, label: "Normal" };
}
