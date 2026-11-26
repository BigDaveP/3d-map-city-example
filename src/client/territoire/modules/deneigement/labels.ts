/**
 * Libellés du déneigement communs aux marquages, au panneau et à la fiche (module pur, testé sous
 * Node).
 */
import { atHour, DAY_TIMES, type EnvAction, type ZoneId } from "@/lib/territoire/day";
import { hourLabel } from "@/lib/territoire/home";
import { banDecision, banTiming, operationDayOf, ZONES, type BanDecision, type ZonePlan } from "@/lib/territoire/neige";

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
  /** libellé du bouton, toujours actif (R11) : un verbe, même sans zone cochée */
  button: string;
  /** style principal du bouton ; secondaire sans zone cochée (décider « aucune interdiction » n'est pas l'action attendue) */
  primary: boolean;
  /** ce que fait le bouton quand aucune zone n'est cochée, sinon null */
  empty: string | null;
  /** mise en garde selon l'heure, jamais bloquante (R11) ; la tardive seulement pendant une décision ; sinon null */
  caution: string | null;
  /** décision en vigueur en une ligne */
  status: string;
}

/**
 * Ce que fait le bouton sans zone cochée, dit sans détour : il annule l'interdiction de ce soir (et la
 * décision par défaut de 10 h si elle n'est pas encore prise) ou lève celle de la nuit en cours.
 */
function emptyLine(t: number, decision: BanDecision | null, night: boolean): string {
  const banned = (decision?.zones.length ?? 0) > 0;
  if (night) return banned ? "Aucune zone cochée : décider maintenant lève l'interdiction de la nuit en cours ; les feux s'éteignent tout de suite." : "Aucune zone cochée : pas d'interdiction cette nuit, les feux restent éteints.";
  if (decision && !banned) return "Aucune zone cochée : pas d'interdiction ce soir, comme la décision en vigueur.";
  if (decision) return "Aucune zone cochée : décider maintenant annule l'interdiction de ce soir ; les feux restent éteints.";
  const defaultAt = hourLabel(atHour(operationDayOf(t), DAY_TIMES.defaultDecisionAt));
  return `Aucune zone cochée : décider maintenant annule l'interdiction de ce soir, y compris la décision par défaut de la direction à ${defaultAt} ; les feux restent éteints.`;
}

const sameZones = (a: readonly ZoneId[], b: readonly ZoneId[]) => a.length === b.length && a.every((z) => b.includes(z));

/**
 * Bloc « Interdiction de stationner » du panneau, à l'heure t : les cases suivent la décision en
 * vigueur (visiteur ou direction) tant que le visiteur ne les change pas ; un choix non enregistré
 * est signalé, et oublié si la décision en vigueur change entre-temps (10:00, autre journée). Le
 * bouton n'est jamais désactivé (R11) : sans zone cochée, il passe au style secondaire, dit
 * « Décider : aucune interdiction » (« Lever l'interdiction cette nuit » la nuit) et une ligne dit
 * qu'il annule l'interdiction de ce soir ; après 15:00, une mise en garde quand un choix est en cours ou
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
    button: checked.length > 0 ? (night ? "Appliquer à la nuit en cours" : "Décider pour ce soir") : night && inForce.length > 0 ? "Lever l'interdiction cette nuit" : "Décider : aucune interdiction",
    primary: checked.length > 0,
    empty: checked.length > 0 ? null : emptyLine(t, decision, night),
    caution:
      timing === "tardive" ? (deciding ? "Décision tardive : les résidents auront moins de temps pour déplacer leur véhicule." : null)
      : night ? `${inForce.length > 0 ? "En vigueur jusqu'à 6 h. " : ""}De nuit, une décision change les feux tout de suite.`
      : timing === "avant-prevision" ? "La prévision du jour arrive à 7 h 30."
      : null,
    status,
  };
}
