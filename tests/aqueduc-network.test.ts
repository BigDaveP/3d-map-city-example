import assert from "node:assert/strict";
import { test } from "node:test";
import { CITY } from "../src/lib/aqueduc/city";
import { segmentsInBox } from "../src/lib/aqueduc/network";
import { loadNetwork } from "./aqueduc-fixture";

test("le tronçon du scénario existe avec ses vraies propriétés", () => {
  const n = loadNetwork();
  const s = n.segments[n.byId.get("13C1949")!];
  assert.equal(s.diameter, 300);
  assert.equal(s.material, "fonte-grise");
  assert.equal(s.year, 1920);
  assert.equal(s.cls, "maitresse");
  assert.ok(Math.abs(s.length - 69.9) < 0.5);
});

test("le graphe a des sources et une adjacence cohérente", () => {
  const n = loadNetwork();
  assert.ok(n.sources.length >= 2);
  for (const s of n.segments) {
    assert.ok(n.adj[s.a].includes(s.idx));
    assert.ok(n.adj[s.b].includes(s.idx));
  }
});

test("segmentsInBox trouve le centre-ville", () => {
  const n = loadNetwork();
  const ids = segmentsInBox(n, CITY.demoBox);
  assert.ok(ids.length > 3000 && ids.length < 6000);
  assert.ok(ids.includes(n.byId.get("13C1949")!));
});
