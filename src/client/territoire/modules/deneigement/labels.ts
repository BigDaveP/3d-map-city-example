/**
 * Libellés du déneigement communs aux marquages, au panneau et à la fiche (module pur, testé sous
 * Node).
 */
import type { EnvAction, ZoneId } from "@/lib/territoire/day";
import { hourLabel } from "@/lib/territoire/home";
import { banDecision, banTiming, operationDayOf, ZONES, type ZonePlan } from "@/lib/territoire/neige";

/** État de l'interdiction en une ligne ; null sans interdiction (le marquage n'affiche alors rien). */
export function banLine(p: ZonePlan): string | null {
  return p.ban === "en-vigueur" ? "Stationnement interdit · 23 h – 6 h" : p.ban === "programmee" ? "Interdiction ce soir" : null;
}

/** « Décidée à 10 h 00 par la direction (simulé) » ou « Décidée par vous à 8 h 00 » ; null sans décision. */
export function decisionLine(p: Pick<ZonePlan, "decidedBy" | "decidedAt">): string | null {
  if (p.decidedBy === null || p.decidedAt === null) return null;
  return p.decidedBy === "direction" ? `Décidée à ${hourLabel(p.decidedAt)} par la direction (simulé)` : `Décidée par vous à ${hourLabel(p.decidedAt)}`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("fr-CA")} ${n > 1 ? many : one}`;

/**
 * Le seul chiffre du marquage d'une zone : l'avancement du déneigement pendant l'interdiction,
 * sinon le nombre de feux et leur état (tous les feux d'une zone partagent le même état).
 */
export function markFigure(p: ZonePlan, lights: number): { value: string; label: string } {
  if (p.ban === "en-vigueur") return { value: `${Math.round(p.progress * 100)}\u202f%`, label: "déneigé" };
  const n = lights.toLocaleString("fr-CA");
  if (p.lights === "programme") return { value: n, label: lights > 1 ? "feux programmés" : "feu programmé" };
  return { value: n, label: lights > 1 ? "feux éteints" : "feu éteint" };
}

/** « 102 feux allumés », « 1 feu programmé »… */
export function lightsLabel(n: number, state: ZonePlan["lights"]): string {
  const word = { eteint: ["éteint", "éteints"], programme: ["programmé", "programmés"], allume: ["allumé", "allumés"] }[state];
  return plural(n, `feu ${word[0]}`, `feux ${word[1]}`);
}

/** Choix en cours du visiteur, lié à la décision sur laquelle il a commencé (`base`). */
export interface Picked {
  base: string;
  zones: ZoneId[];
}

export interface DecisionView {
  /** clé de la décision en vigueur : un choix commencé sur une autre décision est oublié */
  base: string;
  /** zones cochées : le choix en cours, sinon la décision en vigueur */
  checked: ZoneId[];
  /** le choix diffère de la décision en vigueur (non enregistré) */
  dirty: boolean;
  /** libellé du bouton, toujours actif (R11) */
  button: string;
  /** ce que fait le bouton quand aucune zone n'est cochée, sinon null */
  empty: string | null;
  /** mise en garde selon l'heure, jamais bloquante (R11) ; la tardive seulement pendant une décision ; sinon null */
  caution: string | null;
  /** décision en vigueur en une ligne */
  status: string;
}

const sameZones = (a: readonly ZoneId[], b: readonly ZoneId[]) => a.length === b.length && a.every((z) => b.includes(z));

/**
 * Bloc « Interdiction de stationner » du panneau, à l'heure t : les cases suivent la décision en
 * vigueur (visiteur ou direction) tant que le visiteur ne les change pas ; un choix non enregistré
 * est signalé, et oublié si la décision en vigueur change entre-temps (10:00, autre journée). Le
 * bouton n'est jamais désactivé (R11) : sans zone cochée, il dit « Aucune interdiction ce soir » et
 * une ligne explique l'effet ; après 15:00, une mise en garde quand un choix est en cours ou
 * qu'aucune décision n'existe, et la nuit une note, sans rien refuser.
 */
export function decisionView(t: number, actions: readonly EnvAction[], picked: Picked | null): DecisionView {
  const decision = banDecision(t, actions);
  const inForce = decision?.zones ?? [];
  const base = decision ? `${decision.by}@${decision.at}:${inForce.join("")}` : `aucune@${operationDayOf(t)}`;
  const checked = picked && picked.base === base ? ZONES.filter((z) => picked.zones.includes(z)) : [...inForce];
  const timing = banTiming(t);
  const night = timing === "nuit";
  const status = decision
    ? `${decisionLine({ decidedBy: decision.by, decidedAt: decision.at })}${inForce.length === 0 ? " : aucune zone" : ""}`
    : "Aucune décision pour ce soir";
  const dirty = !sameZones(checked, inForce);
  // mise en garde tardive seulement quand une décision tardive est en train de se prendre : un choix
  // non enregistré, ou aucune décision encore ; pas à côté d'une décision déjà en vigueur (R11, R13)
  const deciding = dirty || decision === null;
  return {
    base,
    checked,
    dirty,
    button: checked.length > 0 ? (night ? "Appliquer à la nuit en cours" : "Décider pour ce soir") : night ? "Lever l'interdiction cette nuit" : "Aucune interdiction ce soir",
    empty: checked.length > 0 ? null : night ? "Aucune zone cochée : les feux s'éteignent tout de suite." : "Aucune zone cochée : pas d'interdiction ce soir, les feux restent éteints.",
    caution:
      timing === "tardive" ? (deciding ? "Décision tardive : les résidents auront moins de temps pour déplacer leur véhicule." : null)
      : night ? `${inForce.length > 0 ? "En vigueur jusqu'à 6 h. " : ""}De nuit, une décision change les feux tout de suite.`
      : timing === "avant-prevision" ? "La prévision du jour arrive à 7 h 30."
      : null,
    status,
  };
}
