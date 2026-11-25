import assert from "node:assert/strict";
import { test } from "node:test";
import { PIPE_STOPS, rampColor, rampHex } from "../src/client/aqueduc/pipes";
import { buildTubeInstances, TUBE_DEPTH_M, TUBE_EXAGGERATION, TUBE_FLOATS, tubeSegments } from "../src/client/aqueduc/scene/tubes";

/** Mercator de MapLibre (rayon terrestre 6 371 008,8 m), calculé ici indépendamment du module. */
const EARTH = 2 * Math.PI * 6371008.8;
const mx = (lng: number) => (180 + lng) / 360;
const my = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
const unit = (lat: number) => 1 / (EARTH * Math.cos((lat * Math.PI) / 180));

const seg = (coords: number[], diameter: number) => ({ coords: Float64Array.from(coords), diameter });
// deux tronçons du centre-ville : 3 sommets (2 sous-segments) et 2 sommets (1 sous-segment)
const SEGS = [seg([-72.5436, 46.3446, -72.5431, 46.3449, -72.5425, 46.3451], 300), seg([-72.55, 46.35, -72.5492, 46.3497], 150)];

test("constantes : diamètres exagérés ×12, conduites à 2 m sous la rue", () => {
  assert.equal(TUBE_EXAGGERATION, 12);
  assert.equal(TUBE_DEPTH_M, 2);
  assert.equal(TUBE_FLOATS, 7);
});

test("buildTubeInstances : une instance par sous-segment (début xyz, fin xyz, rayon)", () => {
  const a = buildTubeInstances(SEGS, TUBE_EXAGGERATION, TUBE_DEPTH_M);
  assert.ok(a instanceof Float32Array);
  assert.equal(a.length / TUBE_FLOATS, 3);
  assert.equal(buildTubeInstances([], 12, 2).length, 0);
  // tronçon dégénéré (un seul sommet) : aucune instance
  assert.equal(buildTubeInstances([seg([-72.5, 46.3], 200)], 12, 2).length, 0);
});

test("buildTubeInstances : positions Mercator, z = −2 m en unités Mercator à la latitude", () => {
  const a = buildTubeInstances(SEGS, TUBE_EXAGGERATION, TUBE_DEPTH_M);
  // première instance : du sommet 0 au sommet 1 du premier tronçon
  const [x0, y0, z0, x1, y1, z1] = a.subarray(0, 6);
  const rel = (got: number, want: number) => assert.ok(Math.abs(got - want) <= Math.abs(want) * 1e-6, `${got} ≠ ${want}`);
  rel(x0, mx(-72.5436));
  rel(y0, my(46.3446));
  rel(x1, mx(-72.5431));
  rel(y1, my(46.3449));
  rel(z0, -2 * unit(46.3446));
  rel(z1, -2 * unit(46.3449));
  assert.ok(z0 < 0);
  // la fin d'un sous-segment est le début du suivant
  assert.deepEqual([...a.subarray(3, 6)], [...a.subarray(TUBE_FLOATS, TUBE_FLOATS + 3)]);
  // autre profondeur : z proportionnel
  const b = buildTubeInstances(SEGS, TUBE_EXAGGERATION, 5);
  rel(b[2], -5 * unit(46.3446));
});

test("buildTubeInstances : rayon = diamètre / 2 × 12 (mètres, en unités Mercator)", () => {
  const a = buildTubeInstances(SEGS, TUBE_EXAGGERATION, TUBE_DEPTH_M);
  const lat = (46.3446 + 46.3449) / 2;
  const r300 = (0.3 / 2) * 12 * unit(lat);
  assert.ok(Math.abs(a[6] - r300) <= r300 * 1e-6, `${a[6]} ≠ ${r300}`);
  // 150 mm : 0,9 m de rayon
  const r150 = a[2 * TUBE_FLOATS + 6] / unit((46.35 + 46.3497) / 2);
  assert.ok(Math.abs(r150 - 0.9) < 1e-6, String(r150));
  // sans exagération : rayon réel (7,5 cm)
  const real = buildTubeInstances(SEGS, 1, TUBE_DEPTH_M)[2 * TUBE_FLOATS + 6] / unit((46.35 + 46.3497) / 2);
  assert.ok(Math.abs(real - 0.075) < 1e-7, String(real));
});

test("buildTubeInstances : un gros tube exagéré reste sous la rue (axe abaissé, dessus à −0,2 m)", () => {
  // 600 mm × 12 : rayon 3,6 m > 2 m ; l’axe descend à −3,8 m pour que le dessus reste sous la chaussée
  const a = buildTubeInstances([seg([-72.5436, 46.3446, -72.5431, 46.3449], 600)], TUBE_EXAGGERATION, TUBE_DEPTH_M);
  const u = unit(46.3446);
  assert.ok(Math.abs(a[2] / u + 3.8) < 1e-6, String(a[2] / u));
  const r = a[6] / unit((46.3446 + 46.3449) / 2);
  assert.ok(Math.abs(a[2] / u + r + 0.2) < 1e-4);
  // 300 mm (rayon 1,8 m) : axe à −2 m, inchangé
  assert.ok(Math.abs(buildTubeInstances(SEGS, TUBE_EXAGGERATION, TUBE_DEPTH_M)[2] / u + 2) < 1e-6);
});

test("buildTubeInstances : relatif à une origine, précision sous le millimètre en Float32", () => {
  const origin: [number, number] = [mx(-72.5436), my(46.3446)];
  const a = buildTubeInstances(SEGS, TUBE_EXAGGERATION, TUBE_DEPTH_M, origin);
  const m = unit(46.35);
  // fin du dernier sous-segment, à ~600 m de l'origine
  const k = 2 * TUBE_FLOATS;
  const dx = (a[k + 3] - (mx(-72.5492) - origin[0])) / m;
  const dy = (a[k + 4] - (my(46.3497) - origin[1])) / m;
  assert.ok(Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3, `écart ${dx} m, ${dy} m`);
  // premier sommet = origine
  assert.equal(a[0], 0);
  assert.equal(a[1], 0);
  // z et rayon ne dépendent pas de l'origine
  const abs = buildTubeInstances(SEGS, TUBE_EXAGGERATION, TUBE_DEPTH_M);
  assert.equal(a[2], abs[2]);
  assert.equal(a[6], abs[6]);
});

test("buildTubeInstances : pure (entrées intactes, même résultat à chaque appel)", () => {
  const before = SEGS.map((s) => [...s.coords]);
  const a = buildTubeInstances(SEGS, 12, 2);
  const b = buildTubeInstances(SEGS, 12, 2);
  assert.deepEqual([...a], [...b]);
  assert.deepEqual(
    SEGS.map((s) => [...s.coords]),
    before,
  );
});

test("tubeSegments : par défaut maîtresses, amenées et zone suivie ; « Tout le réseau » : tout", () => {
  const classes = ["distribution", "maitresse", "branchement", "amenee", "distribution", "distribution"] as const;
  const demo = [4, 1];
  assert.deepEqual(tubeSegments(classes, demo, false), [1, 3, 4]);
  assert.deepEqual(tubeSegments(classes, demo, true), [0, 1, 2, 3, 4, 5]);
});

test("rampColor : mêmes paliers que pipeColor, en RGB 0–255", () => {
  assert.deepEqual(rampColor("pression", 1.2), [0xd6, 0x40, 0x2f]);
  assert.deepEqual(rampColor("pression", 5.2), [0x1f, 0x5f, 0xa8]);
  assert.deepEqual(rampColor("pression", 0), [0xd6, 0x40, 0x2f]);
  assert.deepEqual(rampColor("pression", 9), [0x1f, 0x5f, 0xa8]);
  for (const layer of ["pression", "qualite", "age", "rincage", "incidents"] as const)
    for (const v of [PIPE_STOPS[layer].stops[0][0], 0.7, 3.3, 1960, 4]) {
      const hex = rampHex(PIPE_STOPS[layer].stops, v);
      const n = parseInt(hex.slice(1), 16);
      assert.deepEqual(rampColor(layer, v), [(n >> 16) & 255, (n >> 8) & 255, n & 255], `${layer} ${v}`);
    }
});
