import assert from "node:assert/strict";
import { test } from "node:test";
import { CITY } from "../src/lib/aqueduc/city";
import { distancesFrom, isolate, placeValves } from "../src/lib/aqueduc/graph";
import { loadNetwork } from "./aqueduc-fixture";

const n = loadNetwork();
const brk = n.byId.get(CITY.breakSegment)!;

test("distances : nulles aux sources, croissantes, finies pour le centre-ville", () => {
  const d = distancesFrom(n, n.sources);
  for (const s of n.sources) assert.equal(d[s], 0);
  const seg = n.segments[brk];
  assert.ok(Number.isFinite(d[seg.a]) && d[seg.a] > 0);
  // croissance : un segment ne raccourcit jamais de plus sa longueur
  for (const s of n.segments) {
    if (Number.isFinite(d[s.a])) assert.ok(d[s.b] <= d[s.a] + s.length + 1e-6);
  }
});

test("isolation de 13C1949 : au moins 2 vannes, le tronçon isolé, une zone limitée", () => {
  const iso = isolate(n, brk, placeValves(n));
  console.log(`isolation ${CITY.breakSegment} : ${iso.valves.length} vannes, ${iso.isolated.length} tronçons isolés`);
  assert.ok(iso.valves.length >= 2);
  assert.ok(iso.isolated.includes(brk));
  assert.ok(iso.isolated.length >= 3 && iso.isolated.length <= 120); // R8b : une poignée de rues
  assert.ok(iso.isolated.length < n.segments.length * 0.02); // R3 : pas un quartier
});

test("isolation : aucune source n'est dans la zone isolée", () => {
  const iso = isolate(n, brk, placeValves(n));
  const src = new Set(n.sources);
  for (const i of iso.isolated) {
    assert.ok(!src.has(n.segments[i].a) && !src.has(n.segments[i].b));
  }
});

test("isolation déterministe", () => {
  const a = isolate(n, brk, placeValves(n));
  const b = isolate(n, brk, placeValves(n));
  assert.deepEqual(a, b);
});

test("placeValves garde tous les carrefours maîtresse/maîtresse et environ un tiers des autres", () => {
  const valves = placeValves(n);
  let mainJ = 0;
  let mainKept = 0;
  let other = 0;
  let otherKept = 0;
  n.adj.forEach((segs, node) => {
    if (segs.length < 3) return;
    const mains = segs.filter((si) => ["amenee", "maitresse"].includes(n.segments[si].cls)).length;
    if (mains >= 2) {
      mainJ++;
      if (valves.has(node)) mainKept++;
    } else {
      other++;
      if (valves.has(node)) otherKept++;
    }
  });
  assert.equal(mainKept, mainJ);
  const ratio = otherKept / other;
  console.log(`vannes : ${mainJ} carrefours principaux, ${(ratio * 100).toFixed(1)} % des autres`);
  assert.ok(ratio >= 0.2 && ratio <= 0.45);
});
