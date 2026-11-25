/**
 * Coupe souterraine du scénario (module pur, sans React ni navigateur : testé sous Node).
 * La coupe est un plan vertical le long de la corde qui relie les deux vannes du plan d'isolation,
 * prolongée de part et d'autre : les vannes tombent à 15 % et 85 % de la largeur, comme dans la
 * maquette C. Positions en fraction de la largeur (0 = côté `path.from`).
 */
import { createStore } from "zustand/vanilla";
import { lineCenter, segment, type NetIndex } from "../net";

/** Position des deux vannes dans la largeur de la coupe. */
export const VALVE_AT = [0.15, 0.85] as const;

/** Échelle verticale de la coupe (px CSS de la surface de 560 × 230) : profondeur simulée. */
export const CUT_DEPTH = {
  /** bas de la chaussée (px) : 0 m */
  groundPx: 18,
  /** px par mètre de profondeur */
  pxPerM: 80,
  /** axe de la conduite (m) : profondeur typique hors gel au Québec, simulée (la donnée n'existe pas) */
  pipeAxisM: 1.8,
} as const;

/** Libellé d'une vanne : son rang dans l'inventaire des vannes (simulé), trié par nœud. */
export function valveLabel(net: NetIndex, node: number): string {
  return `V-${net.data.valves.findIndex((v) => v.node === node) + 1}`;
}

export interface CutLayout {
  /** extrémités de la coupe [lng, lat], vannes comprises avec la marge */
  from: [number, number];
  to: [number, number];
  /** largeur (m) et distance de vanne à vanne (m) */
  lengthM: number;
  spanM: number;
  valves: { node: number; label: string; x: number }[];
  /** points du profil de pression : tronçon hors zone aux bords, tronçons isolés entre les vannes */
  points: { seg: number; x: number }[];
  /** position du bris (centre du tronçon du scénario) */
  breakX: number;
  /** tronçon du scénario */
  seg: number;
}

const KY = 110_540;
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Disposition de la coupe pour le plan d'isolation reçu du serveur ; null sans plan à deux vannes. */
export function cutLayout(net: NetIndex): CutLayout | null {
  const plan = net.data.scenario;
  const path = plan.path;
  const seg = net.segById.get(plan.segment);
  if (!path || seg === undefined) return null;
  const at = (node: number) => net.data.valves.find((v) => v.node === node)?.at;
  const A = at(path.from);
  const B = at(path.to);
  if (!A || !B) return null;
  const k = kx(A[1]);
  // repère local en mètres, origine en A
  const local = (p: readonly number[]) => [(p[0] - A[0]) * k, (p[1] - A[1]) * KY] as const;
  const [bx, by] = local(B);
  const spanM = Math.hypot(bx, by);
  if (spanM === 0) return null;
  const ux = bx / spanM;
  const uy = by / spanM;
  const lengthM = spanM / (VALVE_AT[1] - VALVE_AT[0]);
  const pad = VALVE_AT[0] * lengthM;
  const from: [number, number] = [A[0] - (ux * pad) / k, A[1] - (uy * pad) / KY];
  const to: [number, number] = [B[0] + (ux * pad) / k, B[1] + (uy * pad) / KY];
  // fraction de la largeur d'un point projeté sur la corde
  const xOf = (p: readonly number[]) => {
    const [x, y] = local(p);
    return (x * ux + y * uy + pad) / lengthM;
  };
  const clampIn = (x: number) => Math.min(VALVE_AT[1], Math.max(VALVE_AT[0], x));
  const inner = path.segments.map((si) => ({ seg: si, x: clampIn(xOf(lineCenter(segment(net, si)))) })).sort((a, b) => a.x - b.x);
  const points = [...(path.before !== null ? [{ seg: path.before, x: 0 }] : []), ...inner, ...(path.after !== null ? [{ seg: path.after, x: 1 }] : [])];
  return {
    from,
    to,
    lengthM,
    spanM,
    valves: [
      { node: path.from, label: valveLabel(net, path.from), x: VALVE_AT[0] },
      { node: path.to, label: valveLabel(net, path.to), x: VALVE_AT[1] },
    ],
    points,
    breakX: clampIn(xOf(lineCenter(segment(net, seg)))),
    seg,
  };
}

/** Exagération de l'échelle verticale de la coupe de `w` px de large (pixels carrés en largeur). */
export const verticalExaggeration = (c: CutLayout, w: number) => CUT_DEPTH.pxPerM / (w / c.lengthM);

/**
 * Sens de lecture de la coupe dans la scène : la surface est retournée quand la caméra passe de
 * l'autre côté (`verticalFlip`) ; son contenu suit (vannes et profil en miroir).
 */
export const cutView = createStore<{ reversed: boolean }>()(() => ({ reversed: false }));
