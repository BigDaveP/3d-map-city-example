/**
 * Libellés du déneigement communs aux marquages, au panneau et à la fiche (module pur, testé sous
 * Node).
 */
import { hourLabel } from "@/lib/territoire/home";
import type { ZonePlan } from "@/lib/territoire/neige";

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
