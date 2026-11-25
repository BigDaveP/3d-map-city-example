import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { distanceM, pointInPolygon, type Polygon } from "../src/lib/territoire/geo";
import { FLEET } from "../src/lib/territoire/fleet";
import type { ZoneId } from "../src/lib/territoire/day";
import { getDeneigementData } from "../src/server/territoire/deneigement";

const read = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../data/territoire/${f}`, import.meta.url), "utf8")) as T;
const zones = read<{ zones: { id: ZoneId; name: string; polygon: Polygon }[]; extractedAt: string }>("stationnement-nuit.json");
const feux = read<{ lights: { id: string; zone: ZoneId; at: [number, number] }[] }>("feux.json");

test("trois zones A, B et C, coordonnées à 5 décimales", () => {
  assert.deepEqual(zones.zones.map((z) => z.id).sort(), ["A", "B", "C"]);
  assert.match(zones.extractedAt, /^\d{4}-\d{2}-\d{2}$/);
  for (const z of zones.zones) {
    assert.equal(z.name, `Zone ${z.id}`);
    for (const ring of z.polygon) for (const [x, y] of ring) assert.ok(x === +x.toFixed(5) && y === +y.toFixed(5), `${x}, ${y}`);
  }
});

test("chaque feu est dans sa zone, avec un identifiant F-zone-numéro", () => {
  for (const l of feux.lights) {
    const z = zones.zones.find((v) => v.id === l.zone)!;
    assert.ok(pointInPolygon(l.at, z.polygon), `${l.id} hors de la zone ${l.zone}`);
  }
  assert.equal(new Set(feux.lights.map((l) => l.id)).size, feux.lights.length);
  for (const l of feux.lights) assert.match(l.id, new RegExp(`^F-${l.zone}-\\d{3}$`));
});

test("20 à 200 feux par zone, espacés d'au moins 250 m", () => {
  for (const id of ["A", "B", "C"] as const) {
    const ls = feux.lights.filter((l) => l.zone === id);
    assert.ok(ls.length >= 20 && ls.length <= 200, `zone ${id} : ${ls.length} feux`);
    for (let i = 0; i < ls.length; i++)
      for (let j = i + 1; j < ls.length; j++) assert.ok(distanceM(ls[i].at, ls[j].at) >= 250, `${ls[i].id} et ${ls[j].id} trop proches`);
  }
});

test("point dans un polygone : trou exclu", () => {
  const p: Polygon = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
  assert.ok(pointInPolygon([2, 2], p));
  assert.ok(!pointInPolygon([5, 5], p));
  assert.ok(!pointInPolygon([11, 5], p));
});

test("flotte simulée : 24 ressources dans 2 dépôts", () => {
  assert.equal(FLEET.length, 24);
  assert.equal(new Set(FLEET.map((r) => r.id)).size, 24);
  assert.deepEqual([...new Set(FLEET.map((r) => r.depot))].sort(), ["est", "ouest"]);
});

test("getDeneigementData : lit les fichiers versionnés, une seule fois", () => {
  const d = getDeneigementData();
  assert.equal(d.lights.length, feux.lights.length);
  assert.equal(d.zones.length, 3);
  assert.equal(d.fleet, FLEET);
  assert.equal(getDeneigementData(), d);
});
