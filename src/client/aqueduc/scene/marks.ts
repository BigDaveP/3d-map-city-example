/**
 * Contenu des inscriptions dans la scène (module pur, sans React ni navigateur : testé sous Node).
 * Les mêmes informations servent aux surfaces HTML-in-Canvas et aux étiquettes DOM du mode classique.
 */
import type { PipeClass } from "@/lib/aqueduc/network";

/** Taille des surfaces (px CSS). */
export const SURFACE_SIZE = {
  sector: { w: 420, h: 90 },
  incident: { w: 520, h: 80 },
  sensor: { w: 120, h: 26 },
} as const;

/** Clés des surfaces : `sector:<id>`, `incident:<tronçon>`, `sensor:<id>`. */
export type SurfaceKind = keyof typeof SURFACE_SIZE;
export const surfaceKey = (kind: SurfaceKind, id: string) => `${kind}:${id}`;
export function parseKey(key: string): { kind: SurfaceKind; id: string } | null {
  const i = key.indexOf(":");
  const kind = key.slice(0, i);
  return i > 0 && kind in SURFACE_SIZE ? { kind: kind as SurfaceKind, id: key.slice(i + 1) } : null;
}

/** [lng, lat] dans [ouest, sud, est, nord]. */
export const inBox = (at: readonly [number, number] | number[], box: readonly [number, number, number, number]) =>
  at[0] >= box[0] && at[0] <= box[2] && at[1] >= box[1] && at[1] <= box[3];

/** Longueur qui compte pour les adresses (une par 12 m de distribution ou de maîtresse, comme la simulation). */
const ADDRESS_M = 12;
const counts = (c: PipeClass) => c === "distribution" || c === "maitresse";

export interface SectorImpact {
  /** adresses en basse pression (sous le seuil, hors zone isolée) */
  low: number;
  /** adresses sans eau (tronçons isolés : pression nulle) */
  dry: number;
}

/**
 * Impact d'un incident par secteur, calculé côté client à partir de la pression reçue du flux
 * (segments de `demo`) : même règle que `incidentImpact` de la simulation (pression nulle = isolé,
 * sans eau ; sous `pressureMin` = basse pression). Les secteurs sans impact sont absents.
 */
export function impactBySector(
  props: readonly { c: PipeClass; s: string; l: number }[],
  demo: readonly number[],
  pressure: ArrayLike<number>,
  pressureMin: number,
): Map<string, SectorImpact> {
  const m = new Map<string, { low: number; dry: number }>();
  for (let k = 0; k < demo.length && k < pressure.length; k++) {
    const p = pressure[k];
    if (p >= pressureMin) continue;
    const s = props[demo[k]];
    if (!s || !counts(s.c)) continue;
    const e = m.get(s.s) ?? { low: 0, dry: 0 };
    if (p === 0) e.dry += s.l;
    else e.low += s.l;
    m.set(s.s, e);
  }
  const out = new Map<string, SectorImpact>();
  for (const [id, e] of m) {
    const v = { low: Math.round(e.low / ADDRESS_M), dry: Math.round(e.dry / ADDRESS_M) };
    if (v.low || v.dry) out.set(id, v);
  }
  return out;
}

export type Tone = "good" | "warn" | "bad";

/** Le seul chiffre d'un marquage de secteur : sans eau, sinon basse pression, sinon adresses desservies. */
export function sectorFigure(served: number, impact: SectorImpact | undefined): { value: number; label: string; tone: Tone } {
  if (impact?.dry) return { value: impact.dry, label: "adresses sans eau", tone: "bad" };
  if (impact?.low) return { value: impact.low, label: "adresses en basse pression", tone: "warn" };
  return { value: served, label: "adresses desservies", tone: "good" };
}

/** Statut 0 | 1 | 2 d'un capteur -> ton de couleur. */
export const TONE: readonly Tone[] = ["good", "warn", "bad"];
