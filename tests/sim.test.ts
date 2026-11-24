import assert from "node:assert/strict";
import { test } from "node:test";
import { getBranches } from "../src/lib/sim/catalog";
import { reviewsAt, SalesSimulator, staffAt, stormChanges, weatherAt } from "../src/lib/sim/generators";
import { getLayout, CARD_W, CARD_H } from "../src/lib/world";
import { createDataStore, htmlSignature } from "../src/client/store";

test("catalogue : 200 succursales uniques, 5 régions équilibrées", () => {
  const b = getBranches(1000);
  assert.equal(b.length, 200);
  assert.equal(new Set(b.map((x) => x.name)).size, 200);
  for (let r = 0; r < 5; r++) assert.equal(b.filter((x) => x.regionIdx === r).length, 40);
  assert.equal(getBranches(250).length, 50);
});

test("polling sans état : déterministe et partiellement changeant", () => {
  const b = getBranches(1000);
  assert.deepEqual(staffAt(b[3], 7), staffAt(b[3], 7));
  const changed = b.filter((x) => JSON.stringify(staffAt(x, 4)) !== JSON.stringify(staffAt(x, 5))).length;
  assert.ok(changed > 20 && changed < 120, `changements staff: ${changed}`);
  assert.ok(reviewsAt(b[0], 3).rating >= 1 && reviewsAt(b[0], 3).rating <= 5);
  assert.ok(typeof weatherAt(b[0], 3).temp === "number");
});

test("SSE : chaque succursale émet entre 1 et 5 s (x1)", () => {
  const b = getBranches(1000);
  const sim = new SalesSimulator(b, 1, 42, 0);
  let count = 0;
  for (let t = 0; t <= 60_000; t += 50) count += sim.tick(t).length;
  // 200 succursales, intervalle moyen 3 s => ~4000 évènements par minute
  assert.ok(count > 3000 && count < 5500, `évènements: ${count}`);
});

test("tempête : ~30 % des cartes", () => {
  const ch = stormChanges(getBranches(1000), 123);
  assert.ok(ch.length > 250 && ch.length < 350, `cartes: ${ch.length}`);
});

test("layout : aucune carte ne se chevauche", () => {
  const L = getLayout(1000);
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const k = `${L.cards[i * 4]},${L.cards[i * 4 + 1]}`;
    assert.ok(!seen.has(k));
    seen.add(k);
    assert.equal(L.cards[i * 4 + 2], CARD_W);
    assert.equal(L.cards[i * 4 + 3], CARD_H);
  }
});

test("store : un lot de ventes marque dirty la carte ventes uniquement", () => {
  const ds = createDataStore(1000);
  ds.pushSales([[2, 120, 3]], 100);
  ds.flush();
  const s = ds.store.getState();
  assert.equal(s.counters.salesEvents, 1);
  assert.ok(ds.live.dirtySince[2 * 5 + 0] === 100, "carte ventes dirty");
  assert.equal(ds.live.dirtySince[2 * 5 + 1], 0, "carte personnel propre");
  assert.equal(htmlSignature(s, 2, "sales"), ds.live.sig[10]);
});

test("store : la tempête change ~30 % des cartes en un seul lot", () => {
  const ds = createDataStore(1000);
  const ch = stormChanges(getBranches(1000), 7);
  ds.pushStorm(ch, 7, 50);
  ds.flush();
  let dirty = 0;
  for (let c = 0; c < 1000; c++) if (ds.live.dirtySince[c]) dirty++;
  assert.ok(dirty >= ch.length * 0.8, `cartes dirty ${dirty} / changements ${ch.length}`);
  assert.equal(ds.store.getState().counters.batches, 1);
});
