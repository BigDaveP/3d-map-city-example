import assert from "node:assert/strict";
import { test } from "node:test";
import { modelMatrix, mul, PanelProjection, placePanel } from "../src/client/carte/hic/geometry";

const anchor = { x: 0.3, y: 0.36, z: 0 };
const unit = 1e-7;

/** normale du plan du panneau = r × d (orientation de lecture) */
function normal(p: ReturnType<typeof placePanel>) {
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
