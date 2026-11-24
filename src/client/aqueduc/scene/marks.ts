/**
 * Contenu des inscriptions dans la scène (module pur, sans React ni navigateur : testé sous Node).
 * Les mêmes informations servent aux surfaces HTML-in-Canvas et aux étiquettes DOM du mode classique.
 */
import type { PipeClass } from "@/lib/aqueduc/network";
import type { SensorKind } from "@/lib/aqueduc/sim";
import type { LayerId } from "../store";

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

/** Capteurs pertinents pour chaque couche : seuls ceux-là portent une étiquette (décision R13). */
export const LAYER_KINDS: Record<LayerId, readonly SensorKind[]> = {
  pression: ["pression", "debit", "reservoir"],
  qualite: ["qualite"],
  age: [],
  rincage: [],
  incidents: [],
};
/** Étiquettes de capteurs affichées au plus. */
export const TAG_MAX = 8;

/**
 * Capteurs qui portent une étiquette, dans l'ordre de priorité : le capteur sélectionné, ceux en
 * alerte, en attention (quelle que soit la couche), puis ceux de la couche active ; dans `box`
 * seulement (sauf la sélection), les plus proches de `center` d'abord, `max` au plus. Une
 * étiquette `covered` (elle cacherait le chiffre d'un marquage) est écartée, sauf la sélection.
 * `status[idx]` : 0 normal, 1 attention, 2 alerte (undefined : pas encore de lecture).
 */
export function pickTags(
  sensors: readonly { id: string; idx: number; kind: SensorKind; at: readonly [number, number] | number[] }[],
  o: {
    layer: LayerId;
    status: ArrayLike<number | undefined>;
    selected: string | null;
    center: readonly [number, number];
    box: readonly [number, number, number, number];
    max?: number;
    covered?: (id: string) => boolean;
  },
): string[] {
  const max = o.max ?? TAG_MAX;
  const kinds = LAYER_KINDS[o.layer];
  const kx = Math.cos((o.center[1] * Math.PI) / 180);
  const dist = (at: readonly number[]) => Math.hypot((at[0] - o.center[0]) * kx, at[1] - o.center[1]);
  const ranked: { id: string; rank: number; d: number }[] = [];
  for (const s of sensors) {
    const st = o.status[s.idx] ?? 0;
    let rank = s.id === o.selected ? 0 : !inBox(s.at, o.box) ? -1 : st === 2 ? 1 : st === 1 ? 2 : kinds.includes(s.kind) ? 3 : -1;
    if (rank > 0 && o.covered?.(s.id)) rank = -1;
    if (rank >= 0) ranked.push({ id: s.id, rank, d: dist(s.at) });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.d - b.d);
  return ranked.slice(0, max).map((r) => r.id);
}

export type Quad = readonly (readonly [number, number])[];

/** Deux polygones convexes (px écran) se recouvrent-ils ? Axes séparateurs. */
export function convexOverlap(a: Quad, b: Quad): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      const nx = y0 - y1;
      const ny = x1 - x0;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const [x, y] of a) {
        const d = x * nx + y * ny;
        amin = Math.min(amin, d);
        amax = Math.max(amax, d);
      }
      for (const [x, y] of b) {
        const d = x * nx + y * ny;
        bmin = Math.min(bmin, d);
        bmax = Math.max(bmax, d);
      }
      if (amax < bmin || bmax < amin) return false;
    }
  return true;
}

/** Rectangle (px écran) en quadrilatère. */
export const rectQuad = (x0: number, y0: number, x1: number, y1: number): Quad => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
