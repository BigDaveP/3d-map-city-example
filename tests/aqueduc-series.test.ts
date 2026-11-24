import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../src/app/api/aqueduc/series/route";
import { localHour, readingsAt, sectorStats } from "../src/lib/aqueduc/sim";
import { getModel } from "../src/server/aqueduc";

const T = Date.UTC(2026, 10, 24, 12, 42); // 07:42 heure de l'Est
const get = async (q: string) => GET(new Request(`http://x/api/aqueduc/series?${q}`));

test("series : 96 points de 15 min sur la journée simulée, à partir de minuit local", async () => {
  const res = await get(`t=${T}`);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.values.length, 96);
  assert.equal(j.step, 900_000);
  assert.equal(localHour(j.from), 0);
  assert.equal(j.unit, "L/s");
  assert.match(j.label, /total/i);
  // total = somme des débits de secteur à chaque pas
  const m = getModel();
  const sum = sectorStats(m, j.from + 30 * 900_000, null).reduce((a, s) => a + s.flowLs, 0);
  assert.ok(Math.abs(j.values[30] - sum) < 0.05);
});

test("series : capteur, secteur et tronçon", async () => {
  const m = getModel();
  const p = await (await get(`t=${T}&sel=sensor:P-01`)).json();
  assert.equal(p.unit, "bar");
  assert.equal(p.values[10], readingsAt(m, p.from + 10 * 900_000, null)[0].value);
  const s = await (await get(`t=${T}&sel=sector:centre-ville`)).json();
  assert.equal(s.unit, "L/s");
  assert.match(s.label, /Centre-ville/);
  const g = await (await get(`t=${T}&sel=segment:13C1949`)).json();
  assert.equal(g.unit, "bar");
  assert.ok(g.values.every((v: number) => v > 0));
});

test("series : l'incident fait chuter la pression de 13C1949 après le bris", async () => {
  const inc = Date.UTC(2026, 10, 24, 11, 57);
  const g = await (await get(`t=${T}&sel=segment:13C1949&inc=${inc}`)).json();
  const k = Math.floor((inc - g.from) / 900_000);
  assert.ok(g.values[k + 2] < g.values[k - 2] * 0.6, `${g.values[k - 2]} → ${g.values[k + 2]}`);
});

test("series : sélection inconnue ou paramètres invalides → 400", async () => {
  assert.equal((await get(`t=${T}&sel=sensor:X-99`)).status, 400);
  assert.equal((await get(`t=${T}&sel=bidon`)).status, 400);
  assert.equal((await get(`t=abc`)).status, 400);
  assert.equal((await get(`t=${T}&closed=-1`)).status, 400);
});
