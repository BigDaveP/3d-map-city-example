/**
 * Géométrie des panneaux dans la scène MapLibre (coordonnées Mercator 0..1, z = altitude).
 * Un panneau est un plan : (u, v) en px CSS de l'élément -> monde = O + u·R + v·D.
 */

import type { Map as MlMap } from "maplibre-gl";

export type Mat4 = Float64Array | number[];

/** Produit de matrices 4×4 en colonnes (convention WebGL / gl-matrix) : a × b. */
export function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
  return o;
}

export interface PanelPlacement {
  /** coin haut-gauche (Mercator) */
  o: [number, number, number];
  /** vecteur « droite » par px CSS */
  r: [number, number, number];
  /** vecteur « bas » par px CSS */
  d: [number, number, number];
}

/** Matrice modèle : (u, v, 0, 1) -> Mercator. */
export function modelMatrix(p: PanelPlacement): Float64Array {
  return new Float64Array([p.r[0], p.r[1], p.r[2], 0, p.d[0], p.d[1], p.d[2], 0, 0, 0, 1, 0, p.o[0], p.o[1], p.o[2], 1]);
}

/**
 * Placement d'un panneau de w×h px CSS centré horizontalement au-dessus de l'ancre.
 *  - « billboard » : le panneau fait face à la caméra (lacet = cap, tangage = inclinaison) ;
 *  - « facade » : plan vertical d'orientation fixe (`facadeDeg`), vu en biais.
 * `unit` = mètres -> Mercator à l'ancre ; `mPerPx` = taille d'un px CSS du panneau en mètres.
 */
export function placePanel(
  anchor: { x: number; y: number; z: number },
  w: number,
  h: number,
  unit: number,
  mPerPx: number,
  liftM: number,
  mode: "billboard" | "facade",
  bearingDeg: number,
  pitchDeg: number,
  facadeDeg: number,
): PanelPlacement {
  const s = unit * mPerPx;
  let r: [number, number, number];
  let up: [number, number, number];
  if (mode === "billboard") {
    const b = (bearingDeg * Math.PI) / 180;
    const p = (pitchDeg * Math.PI) / 180;
    // x = est, y = sud (Mercator), z = haut. Vers la caméra : n = -avant.
    const f: [number, number, number] = [Math.sin(b) * Math.sin(p), -Math.cos(b) * Math.sin(p), -Math.cos(p)];
    const n: [number, number, number] = [-f[0], -f[1], -f[2]];
    r = [Math.cos(b), Math.sin(b), 0];
    up = [r[1] * n[2] - r[2] * n[1], r[2] * n[0] - r[0] * n[2], r[0] * n[1] - r[1] * n[0]];
  } else {
    let t = (facadeDeg * Math.PI) / 180;
    // vu de dos, le texte serait en miroir : la normale du plan (-sin t, cos t, 0) doit pointer
    // vers la caméra, soit sin(pitch)·cos(t - cap) > 0 ; sinon on retourne le panneau de 180°
    const b = (bearingDeg * Math.PI) / 180;
    if (Math.cos(t - b) < 0) t += Math.PI;
    r = [Math.cos(t), Math.sin(t), 0];
    up = [0, 0, 1];
  }
  const R: [number, number, number] = [r[0] * s, r[1] * s, r[2] * s];
  const D: [number, number, number] = [-up[0] * s, -up[1] * s, -up[2] * s];
  // bas du panneau à `liftM` mètres au-dessus de l'ancre, centré horizontalement
  const bottom: [number, number, number] = [anchor.x, anchor.y, anchor.z + liftM * unit];
  const o: [number, number, number] = [bottom[0] - (w / 2) * R[0] - h * D[0], bottom[1] - (w / 2) * R[1] - h * D[1], bottom[2] - (w / 2) * R[2] - h * D[2]];
  return { o, r: R, d: D };
}

/** Hauteur d'un marquage au sol (m) : juste au-dessus des routes, sous tout bâtiment. */
export const GROUND_LIFT_M = 0.3;

/**
 * Marquage au sol de w×h px CSS centré sur `center` : plan horizontal à 0,3 m du sol.
 * `headingDeg` = cap (degrés, sens horaire depuis le nord) vers lequel pointe le haut du texte ;
 * le texte se lit de face quand ce cap est celui de la caméra. Vu de l'autre côté
 * (cos(orientation − cap) < 0), il est retourné de 180° pour ne jamais se lire à l'envers.
 * `unit` = mètres -> Mercator au centre ; `mPerPx` = taille d'un px CSS du marquage en mètres.
 */
export function placeGround(
  center: { x: number; y: number; z: number },
  w: number,
  h: number,
  unit: number,
  mPerPx: number,
  headingDeg: number,
  bearingDeg: number,
): PanelPlacement {
  let t = (headingDeg * Math.PI) / 180;
  if (Math.cos(t - (bearingDeg * Math.PI) / 180) < 0) t += Math.PI;
  const s = unit * mPerPx;
  // x = est, y = sud : « droite » du texte au cap t + 90°, « bas » vers le cap t + 180°
  const R: [number, number, number] = [Math.cos(t) * s, Math.sin(t) * s, 0];
  const D: [number, number, number] = [-Math.sin(t) * s, Math.cos(t) * s, 0];
  const z = center.z + GROUND_LIFT_M * unit;
  return { o: [center.x - (w / 2) * R[0] - (h / 2) * D[0], center.y - (w / 2) * R[1] - (h / 2) * D[1], z], r: R, d: D };
}

/** Marge (cosinus, ≈ 8,6°) que la caméra doit franchir pour retourner une coupe déjà orientée. */
export const FLIP_MARGIN = 0.15;

/**
 * La coupe `from` -> `to` doit-elle être parcourue à l'envers (`to` -> `from`) pour se lire de face ?
 * Sa normale pointe vers la caméra si cos(angle du segment − cap) > 0. Avec l'état précédent
 * (`prev`), la décision ne change qu'au-delà de `FLIP_MARGIN` : quand la caméra regarde dans l'axe
 * du segment, la coupe ne bascule pas d'une image à l'autre.
 */
export function verticalFlip(from: [number, number], to: [number, number], bearingDeg: number, prev?: boolean): boolean {
  const c = Math.cos(Math.atan2(to[1] - from[1], to[0] - from[0]) - (bearingDeg * Math.PI) / 180);
  if (prev === undefined) return c < 0;
  return prev ? c < FLIP_MARGIN : c < -FLIP_MARGIN;
}

/**
 * Plan vertical le long d'un segment (Mercator), sous la chaussée : coupe de w×h px CSS dont la
 * largeur couvre exactement `from` -> `to` (pixels carrés : la hauteur suit l'échelle de la
 * largeur) et dont le bord haut est à `depthTopM` mètres sous le sol. Le plan est parcouru dans
 * le sens qui le rend lisible depuis la caméra (sinon `to` -> `from`) ; `flipped` impose ce sens
 * (décision de `verticalFlip` avec hystérésis). `h` ne change pas le placement : la coupe descend
 * de h × (longueur du segment / w) sous son bord haut.
 */
export function placeVertical(
  from: [number, number],
  to: [number, number],
  depthTopM: number,
  h: number,
  unit: number,
  bearingDeg: number,
  w: number,
  flipped: boolean = verticalFlip(from, to, bearingDeg),
): PanelPlacement {
  // normale r × d = (−r_y, r_x, 0)·s ; vers la caméra si cos(angle du segment − cap) > 0
  const [a, b] = flipped ? [to, from] : [from, to];
  const R: [number, number, number] = [(b[0] - a[0]) / w, (b[1] - a[1]) / w, 0];
  const D: [number, number, number] = [0, 0, -Math.hypot(R[0], R[1])];
  return { o: [a[0], a[1], -depthTopM * unit], r: R, d: D };
}

/** NDC -> px CSS du canvas (y vers le bas). */
export function viewportMatrix(wCss: number, hCss: number): Float64Array {
  return new Float64Array([wCss / 2, 0, 0, 0, 0, -hCss / 2, 0, 0, 0, 0, 1, 0, wCss / 2, hCss / 2, 0, 1]);
}

/**
 * Homographie du plan du panneau (z = 0) vers l'écran, extraite de la matrice 4×4 élément -> écran,
 * et son inverse : sert à savoir quel point du panneau est sous le curseur.
 */
export class PanelProjection {
  /** élément (px CSS) -> canvas (px CSS), 4×4 projective (pour updateElementGeometry) */
  m: Float64Array;
  private inv: number[];
  constructor(screenFromElement: Float64Array) {
    this.m = screenFromElement;
    const M = screenFromElement;
    // colonnes u, v, translation ; lignes x, y, w
    const h = [M[0], M[4], M[12], M[1], M[5], M[13], M[3], M[7], M[15]];
    this.inv = inv3(h);
  }
  /** px écran -> (u, v) dans le panneau, ou null si derrière la caméra */
  unproject(x: number, y: number): [number, number] | null {
    const i = this.inv;
    const u = i[0] * x + i[1] * y + i[2];
    const v = i[3] * x + i[4] * y + i[5];
    const w = i[6] * x + i[7] * y + i[8];
    if (Math.abs(w) < 1e-12) return null;
    return [u / w, v / w];
  }
  /** (u, v) -> [x, y, wClip] (wClip > 0 devant la caméra ; plus petit = plus proche) */
  project(u: number, v: number): [number, number, number] {
    const M = this.m;
    const x = M[0] * u + M[4] * v + M[12];
    const y = M[1] * u + M[5] * v + M[13];
    const w = M[3] * u + M[7] * v + M[15];
    return [x / w, y / w, w];
  }
}

function inv3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = Math.abs(det) < 1e-30 ? 0 : 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** Mètres par pixel écran au centre de la vue (tuiles de 512 px). */
export const metersPerPixel = (lat: number, zoom: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));

/** px écran par mètre à un point, mesurés dans la direction de la droite de l'écran (sans raccourci). */
export function pxPerMeter(map: Pick<MlMap, "project">, at: [number, number], bearing: number): number {
  const b = (bearing * Math.PI) / 180;
  const d = 10;
  const p0 = map.project(at);
  const p1 = map.project([at[0] + (Math.cos(b) * d) / (111_320 * Math.cos((at[1] * Math.PI) / 180)), at[1] - (Math.sin(b) * d) / 110_540]);
  return Math.hypot(p1.x - p0.x, p1.y - p0.y) / d;
}
