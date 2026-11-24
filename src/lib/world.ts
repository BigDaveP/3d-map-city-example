/**
 * Disposition du mur dans le « monde » (unités = px CSS au zoom 1).
 * 5 régions (3 + 2), chaque région = 2 colonnes de succursales, chaque succursale = une
 * rangée de 5 cartes (une par indicateur).
 */
import { getBranches, REGIONS } from "./sim/catalog";
import { KINDS } from "./sim/types";

export const CARD_W = 340;
export const CARD_H = 230;
export const CARD_GAP = 14;
export const ROW_GAP = 30;
export const COL_GAP = 90;
export const REGION_PAD = 70;
export const REGION_HEADER = 150;
export const REGION_GAP = 260;
export const REGIONS_PER_ROW = 3;
export const BRANCH_COLS = 2;

/** Taille CSS de la version « intermédiaire » : la texture coûte 0,6² = 36 % de la complète. */
export const MID_SCALE = 0.6;

/** Seuils du zoom sémantique. */
export const ZOOM_MID = 0.25;
export const ZOOM_CLOSE = 0.7;
export const ZOOM_MIN = 0.03;
export const ZOOM_MAX = 1.6;

export type Level = 0 | 1 | 2; // éloigné, intermédiaire, rapproché
export const levelForZoom = (z: number): Level => (z < ZOOM_MID ? 0 : z <= ZOOM_CLOSE ? 1 : 2);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldLayout {
  n: number;
  /** x, y, w, h par carte */
  cards: Float32Array;
  regions: (Rect & { name: string; id: string })[];
  bounds: Rect;
  /** largeur de colonne de succursales */
  rowW: number;
}

const cache = new Map<number, WorldLayout>();

export function getLayout(n: number): WorldLayout {
  const hit = cache.get(n);
  if (hit) return hit;
  const branches = getBranches(n);
  const perRegion = Math.ceil(branches.length / REGIONS.length);
  const rowsPerRegion = Math.ceil(perRegion / BRANCH_COLS);
  const rowW = KINDS.length * CARD_W + (KINDS.length - 1) * CARD_GAP;
  const regionW = REGION_PAD * 2 + BRANCH_COLS * rowW + (BRANCH_COLS - 1) * COL_GAP;
  const regionH = REGION_HEADER + REGION_PAD + rowsPerRegion * (CARD_H + ROW_GAP) - ROW_GAP;
  const regions = REGIONS.map((r, i) => ({
    id: r.id,
    name: r.name,
    x: (i % REGIONS_PER_ROW) * (regionW + REGION_GAP),
    y: Math.floor(i / REGIONS_PER_ROW) * (regionH + REGION_GAP),
    w: regionW,
    h: regionH,
  }));
  const cards = new Float32Array(branches.length * KINDS.length * 4);
  for (const b of branches) {
    const reg = regions[b.regionIdx];
    const local = b.idx - b.regionIdx * perRegion;
    const col = Math.floor(local / rowsPerRegion);
    const row = local % rowsPerRegion;
    const x0 = reg.x + REGION_PAD + col * (rowW + COL_GAP);
    const y0 = reg.y + REGION_HEADER + row * (CARD_H + ROW_GAP);
    for (let k = 0; k < KINDS.length; k++) {
      const c = (b.idx * KINDS.length + k) * 4;
      cards[c] = x0 + k * (CARD_W + CARD_GAP);
      cards[c + 1] = y0;
      cards[c + 2] = CARD_W;
      cards[c + 3] = CARD_H;
    }
  }
  const rows = Math.ceil(REGIONS.length / REGIONS_PER_ROW);
  const layout: WorldLayout = {
    n,
    cards,
    regions,
    bounds: { x: 0, y: 0, w: REGIONS_PER_ROW * regionW + (REGIONS_PER_ROW - 1) * REGION_GAP, h: rows * regionH + (rows - 1) * REGION_GAP },
    rowW,
  };
  cache.set(n, layout);
  return layout;
}
