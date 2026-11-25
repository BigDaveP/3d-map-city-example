import assert from "node:assert/strict";
import { test } from "node:test";
import { modelMatrix, mul, PanelProjection, placeGround, placePanel, placeVertical, verticalFlip } from "../src/client/hic3d/geometry";

const anchor = { x: 0.3, y: 0.36, z: 0 };
const unit = 1e-7;

/** normale du plan du panneau = r × d (orientation de lecture) */
function normal(p: { r: number[]; d: number[] }) {
  const [r, d] = [p.r, p.d];
  return [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
}
/** vecteur de la cible vers la caméra (x est, y sud, z haut) */
function toCamera(bearing: number, pitch: number) {
  const b = (bearing * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return [-Math.sin(b) * Math.sin(p), Math.cos(b) * Math.sin(p), Math.cos(p)];
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("face caméra : le panneau est lisible quel que soit le cap", () => {
  for (const bearing of [0, 45, 90, 180, 270]) {
    const p = placePanel(anchor, 300, 236, unit, 0.5, 30, "billboard", bearing, 60, 0);
    // panneau lisible (pas en miroir) : r × d pointe vers la caméra
    assert.ok(dot(normal(p), toCamera(bearing, 60)) > 0, `cap ${bearing}`);
  }
});

test("façade : retournée quand la caméra passe derrière (pas de texte en miroir)", () => {
  for (const bearing of [0, 90, 180, 270]) {
    const p = placePanel(anchor, 300, 236, unit, 0.5, 30, "facade", bearing, 60, 20);
    assert.ok(dot(normal(p), toCamera(bearing, 60)) > 0, `cap ${bearing} : panneau vu de dos`);
  }
});

test("homographie : projeter puis déprojeter redonne le point du panneau", () => {
  const p = placePanel(anchor, 300, 236, unit, 0.5, 30, "billboard", 30, 55, 0);
  // projection perspective simple : x' = x/w avec w dépendant de z
  const proj = new Float64Array([1e5, 0, 0, 0, 0, 1e5, 0, 0, 0, 0, 1, 2e5, 0, 0, 0, 1]);
  const pr = new PanelProjection(mul(proj, modelMatrix(p)));
  for (const [u, v] of [[0, 0], [150, 118], [299, 235], [42, 200]]) {
    const [x, y] = pr.project(u, v);
    const back = pr.unproject(x, y)!;
    assert.ok(Math.abs(back[0] - u) < 1e-6 && Math.abs(back[1] - v) < 1e-6, `${u},${v} -> ${back}`);
  }
});

// --- surfaces de la démo réseau d'eau : marquages au sol et coupe verticale
const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
/** vecteur horizontal de la cible vers la caméra, et « droite » de l'écran (x est, y sud) */
const towardsCamera = (bearing: number) => [-Math.sin((bearing * Math.PI) / 180), Math.cos((bearing * Math.PI) / 180), 0];
const screenRight = (bearing: number) => [Math.cos((bearing * Math.PI) / 180), Math.sin((bearing * Math.PI) / 180), 0];

test("placeGround : plan horizontal à 0,3 m du sol, normale vers le haut", () => {
  for (const heading of [-25, 0, 37, 150, 260])
    for (const bearing of [0, 90, 180, 270]) {
      const p = placeGround(anchor, 420, 90, unit, 1.2, heading, bearing);
      assert.ok(normal(p)[2] > 0, `cap ${bearing}, orientation ${heading} : normale ${normal(p)}`);
      assert.equal(p.r[2], 0);
      assert.equal(p.d[2], 0);
      // centre du marquage sur l'ancre, 0,3 m au-dessus du sol
      const c = [p.o[0] + 210 * p.r[0] + 45 * p.d[0], p.o[1] + 210 * p.r[1] + 45 * p.d[1], p.o[2]];
      assert.ok(Math.abs(c[0] - anchor.x) < 1e-15 && Math.abs(c[1] - anchor.y) < 1e-15, `centre ${c}`);
      assert.ok(Math.abs(c[2] - (anchor.z + 0.3 * unit)) < 1e-18, `hauteur ${c[2]}`);
      // un px CSS = 1,2 m
      assert.ok(Math.abs(len(p.r) - 1.2 * unit) < 1e-18 && Math.abs(len(p.d) - 1.2 * unit) < 1e-18);
    }
});

test("placeGround : lisible quel que soit le cap (bas du texte vers la caméra, pas en miroir)", () => {
  for (const heading of [-25, 0, 37, 150, 260])
    for (const bearing of [0, 90, 180, 270]) {
      const p = placeGround(anchor, 420, 90, unit, 1.2, heading, bearing);
      assert.ok(dot(p.d, towardsCamera(bearing)) >= 0, `cap ${bearing}, orientation ${heading} : texte à l'envers`);
      assert.ok(dot(p.r, screenRight(bearing)) >= 0, `cap ${bearing}, orientation ${heading} : texte en miroir`);
    }
  // orientation = cap : le texte se lit de face, sans rotation
  const p = placeGround(anchor, 420, 90, unit, 1, 30, 30);
  assert.ok(Math.abs(dot(p.r, screenRight(30)) - unit) < 1e-18);
});

test("placeVertical : plan vertical le long du segment, sous la chaussée, lisible côté caméra", () => {
  const from: [number, number] = [anchor.x, anchor.y];
  const to: [number, number] = [anchor.x + 60 * unit * Math.cos(0.5), anchor.y + 60 * unit * Math.sin(0.5)];
  for (const bearing of [0, 90, 180, 270]) {
    const p = placeVertical(from, to, 0.5, 230, unit, bearing, 560);
    // d porte z (vers le bas), r est horizontal et parallèle au segment
    assert.ok(p.d[0] === 0 && p.d[1] === 0 && p.d[2] < 0, `d ${p.d}`);
    assert.equal(p.r[2], 0);
    const seg = [to[0] - from[0], to[1] - from[1], 0];
    assert.ok(Math.abs(seg[0] * p.r[1] - seg[1] * p.r[0]) < 1e-24, "r parallèle au segment");
    // la largeur couvre exactement le segment ; haut à 0,5 m sous le sol ; pixels carrés
    const ends = [p.o, [p.o[0] + 560 * p.r[0], p.o[1] + 560 * p.r[1], p.o[2]]].map((e) => [e[0], e[1]]);
    const ok = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-15;
    assert.ok((ok(ends[0], from) && ok(ends[1], to)) || (ok(ends[0], to) && ok(ends[1], from)), `extrémités ${ends}`);
    assert.ok(Math.abs(p.o[2] + 0.5 * unit) < 1e-18, `haut ${p.o[2]}`);
    assert.ok(Math.abs(len(p.d) - len(p.r)) < 1e-18);
    // normale vers la caméra (inclinaison 60°)
    assert.ok(dot(normal(p), toCamera(bearing, 60)) > 0, `cap ${bearing} : coupe vue de dos`);
  }
});

test("verticalFlip : hystérésis près de l'axe du segment (pas de scintillement de la coupe)", () => {
  const from: [number, number] = [anchor.x, anchor.y];
  // segment vers l'est (Mercator : x croissant) : lisible de face pour un cap nord (0°)
  const to: [number, number] = [anchor.x + 60 * unit, anchor.y];
  assert.equal(verticalFlip(from, to, 0), false);
  assert.equal(verticalFlip(from, to, 180), true);
  // cap à 90° (caméra dans l'axe du segment) : sans état, la décision bascule d'un degré à l'autre
  assert.notEqual(verticalFlip(from, to, 89), verticalFlip(from, to, 91));
  // avec l'état précédent, elle tient tant qu'on ne dépasse pas la marge
  for (const b of [80, 89, 91, 95]) {
    assert.equal(verticalFlip(from, to, b, false), false, `cap ${b}, non retournée`);
    assert.equal(verticalFlip(from, to, b, true), b < 85 ? false : true, `cap ${b}, retournée`);
  }
  assert.equal(verticalFlip(from, to, 110, false), true);
  // placeVertical suit la décision imposée
  const kept = placeVertical(from, to, 0, 230, unit, 95, 560, false);
  assert.ok(kept.r[0] > 0, "coupe gardée dans le sens from -> to");
  const auto = placeVertical(from, to, 0, 230, unit, 95, 560);
  assert.ok(auto.r[0] < 0, "sans décision imposée : retournée dès que la caméra passe l'axe");
});
