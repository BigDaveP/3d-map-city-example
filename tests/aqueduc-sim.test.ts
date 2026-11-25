import assert from "node:assert/strict";
import { test } from "node:test";
import { CITY } from "../src/lib/aqueduc/city";
import { isolate } from "../src/lib/aqueduc/graph";
import {
  breakHistory,
  buildModel,
  extraTagNodes,
  FLUSHING_2026,
  incidentImpact,
  pointReadings,
  readingsAt,
  sectorStats,
  segmentValues,
  THRESHOLDS,
  type IncidentInput,
} from "../src/lib/aqueduc/sim";
import { loadNetwork } from "./aqueduc-fixture";

const n = loadNetwork();
const t0 = performance.now();
const m = buildModel(n, CITY);
const buildMs = performance.now() - t0;
const brk = n.byId.get(CITY.breakSegment)!;
/** 24 novembre 2026, minuit heure de l'Est (UTC−5) */
const DAY = Date.UTC(2026, 10, 24, 5, 0);
const at = (h: number) => DAY + h * 3_600_000;
const T = at(10.25);
const P01 = m.sensors.find((s) => s.id === "P-01")!;
const MIN = 60_000;

const breakAt = (startedAt: number, extra: Partial<IncidentInput> = {}): IncidentInput => ({
  segment: brk,
  startedAt,
  closedValves: [],
  restoredAt: null,
  ...extra,
});

test("buildModel rapide", () => {
  console.log(`buildModel : ${buildMs.toFixed(0)} ms`);
  assert.ok(buildMs < 1000);
});

test("déterministe", () => {
  assert.deepEqual(readingsAt(m, T, null), readingsAt(m, T, null));
  const inc = breakAt(T - 20_000);
  assert.deepEqual(readingsAt(m, T, inc), readingsAt(m, T, inc));
  assert.deepEqual(segmentValues(m, T, inc, "pression"), segmentValues(m, T, inc, "pression"));
  const m2 = buildModel(n, CITY);
  assert.deepEqual(m2.sensors, m.sensors);
  assert.deepEqual(m2.sectors, m.sectors);
  assert.deepEqual(m2.sectorOf, m.sectorOf);
});

test("cycle de 24 h : débit de nuit (3 h) < pointe du matin (7 h 30)", () => {
  const total = (t: number) => sectorStats(m, t, null).reduce((a, s) => a + s.flowLs, 0);
  assert.ok(total(at(3)) < total(at(7.5)) * 0.5);
  const debit = (t: number) =>
    readingsAt(m, t, null).reduce((a, r, i) => a + (m.sensors[i].kind === "debit" ? r.value : 0), 0);
  assert.ok(debit(at(3)) < debit(at(7.5)));
  // la pression baisse à la pointe
  assert.ok(readingsAt(m, at(3), null)[P01.idx].value > readingsAt(m, at(7.5), null)[P01.idx].value);
  // aucune lecture en alerte sans incident, à toute heure
  for (let h = 0; h < 24; h += 0.5) {
    for (const r of readingsAt(m, at(h), null)) assert.notEqual(r.status, "alerte");
  }
});

test("chlore résiduel ≥ 0,2 mg/L sans incident et décroissant avec la distance", () => {
  const q = segmentValues(m, T, null, "qualite");
  for (const v of q) assert.ok(v >= THRESHOLDS.chloreMin, `chlore ${v}`);
  const r = readingsAt(m, T, null);
  const qs = m.sensors.filter((s) => s.kind === "qualite");
  for (const a of qs) {
    assert.equal(r[a.idx].unit, "mg/L");
    assert.ok(r[a.idx].value >= THRESHOLDS.chloreMin);
    for (const b of qs) {
      if (m.dist[a.node] + 2000 < m.dist[b.node]) assert.ok(r[a.idx].value > r[b.idx].value);
    }
  }
});

test("fuite invisible : un secteur a un ratio de débit de nuit ≥ 1,15, les autres < 1,05", () => {
  const stats = sectorStats(m, T, null);
  const leak = m.sectors.find((s) => s.name === "Sainte-Cécile")!;
  for (const s of stats) {
    if (s.id === leak.id) assert.ok(s.nightRatio >= 1.15, `${s.id} ${s.nightRatio}`);
    else assert.ok(s.nightRatio < 1.05, `${s.id} ${s.nightRatio}`);
  }
  console.log(`ratio de nuit ${leak.name} : ${stats.find((s) => s.id === leak.id)!.nightRatio.toFixed(3)}`);
});

test("bris : la pression au capteur le plus proche chute d'au moins 60 % dans les 60 s", () => {
  assert.equal(P01.node, n.segments[brk].a); // R2
  const inc = breakAt(T);
  const before = readingsAt(m, T - 1000, inc)[P01.idx].value;
  const after = readingsAt(m, T + 60_000, inc)[P01.idx];
  console.log(`P-01 : ${before.toFixed(2)} → ${after.value.toFixed(2)} bar (${((1 - after.value / before) * 100).toFixed(0)} %)`);
  assert.ok(after.value <= before * 0.4);
  assert.equal(after.status, "alerte");
  // pointe de débit entrant sur le secteur
  const sec = m.sectors[m.sectorOf[brk]].id;
  const flow = (inc2: IncidentInput | null) => sectorStats(m, T + 60_000, inc2).find((s) => s.id === sec)!.flowLs;
  assert.ok(flow(inc) > flow(null));
});

test("vannes fermées : pression nulle sur les segments isolés, rétablie ailleurs", () => {
  const iso = isolate(n, brk, m.valves);
  const inc = breakAt(T, { closedValves: iso.valves });
  const t = T + 20 * MIN;
  const p = segmentValues(m, t, inc, "pression");
  const base = segmentValues(m, t, null, "pression");
  const isolated = new Set(iso.isolated);
  for (let i = 0; i < p.length; i++) {
    if (isolated.has(i)) assert.equal(p[i], 0);
    else assert.equal(p[i], base[i]);
  }
  const imp = incidentImpact(m, t, inc);
  assert.ok(imp.withoutWaterAddresses > 0);
  assert.equal(imp.lowPressureAddresses, 0);
  const sec = m.sectors[m.sectorOf[brk]];
  const stat = sectorStats(m, t, inc).find((s) => s.id === sec.id)!;
  assert.ok(stat.served < sec.addresses);
  console.log(`incidentImpact isolé : ${JSON.stringify(imp)}`);
});

test("incidentImpact : basse pression avant l'isolation, rien sans incident", () => {
  assert.deepEqual(incidentImpact(m, T, null), { lowPressureAddresses: 0, withoutWaterAddresses: 0 });
  const imp = incidentImpact(m, T + 5 * MIN, breakAt(T));
  console.log(`incidentImpact avant isolation : ${JSON.stringify(imp)}`);
  assert.ok(imp.lowPressureAddresses > 0);
  assert.equal(imp.withoutWaterAddresses, 0);
});

test("après rétablissement : turbidité temporaire > 0,5 UTN dans le secteur, puis < 0,3 après 2 h", () => {
  const iso = isolate(n, brk, m.valves);
  const restoredAt = T + 3 * 60 * MIN;
  const inc = breakAt(T, { closedValves: iso.valves, restoredAt });
  const sec = m.sectors[m.sectorOf[brk]].id;
  const q = m.sensors.find((s) => s.kind === "qualite" && s.sector === sec)!;
  assert.ok(readingsAt(m, restoredAt - MIN, inc)[q.idx].extra!.turbidity < 0.3);
  assert.ok(readingsAt(m, restoredAt + 5 * MIN, inc)[q.idx].extra!.turbidity > 0.5);
  assert.ok(readingsAt(m, restoredAt + 2 * 60 * MIN, inc)[q.idx].extra!.turbidity < 0.3);
  // remise en eau progressive en 10 min
  const p = (t: number) => segmentValues(m, t, inc, "pression")[brk];
  const base = segmentValues(m, restoredAt + 10 * MIN, null, "pression")[brk];
  assert.ok(p(restoredAt + 2 * MIN) > 0 && p(restoredAt + 2 * MIN) < base);
  assert.equal(p(restoredAt + 10 * MIN), base);
  assert.deepEqual(incidentImpact(m, restoredAt + 10 * MIN, inc), { lowPressureAddresses: 0, withoutWaterAddresses: 0 });
});

test("10 secteurs, 40 capteurs pression/débit, 10 qualité, réservoirs = sources RSV", () => {
  assert.equal(m.sectors.length, 10);
  assert.deepEqual(
    m.sectors.map((s) => s.name),
    CITY.sectorSeeds.map((s) => s.name),
  );
  const ids = (k: string) => m.sensors.filter((s) => s.kind === k).map((s) => s.id);
  const seq = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}-${String(i + 1).padStart(2, "0")}`);
  assert.deepEqual(ids("pression"), seq("P", 30));
  assert.deepEqual(ids("debit"), seq("D", 10));
  assert.deepEqual(ids("qualite"), seq("Q", 10));
  const rsv = n.sources.filter((s) => n.nodes[s].includes("RSV"));
  assert.deepEqual(m.sensors.filter((s) => s.kind === "reservoir").map((s) => s.node), rsv);
  m.sensors.forEach((s, i) => assert.equal(s.idx, i));
  // capteurs pression/débit sur des nœuds distincts de conduites maîtresses
  const pd = m.sensors.filter((s) => s.kind === "pression" || s.kind === "debit");
  assert.equal(new Set(pd.map((s) => s.node)).size, 40);
  for (const s of pd) assert.ok(n.adj[s.node].some((si) => n.segments[si].cls === "maitresse"));
  // une station de qualité par secteur
  assert.deepEqual(
    m.sensors.filter((s) => s.kind === "qualite").map((s) => s.sector),
    m.sectors.map((s) => s.id),
  );
  // chaque segment a un secteur ; adresses = (distribution + maîtresse) / 12 m (R8)
  assert.equal(m.sectorOf.length, n.segments.length);
  for (const sec of m.sectors) {
    let len = 0;
    for (const i of sec.segments) {
      const c = n.segments[i].cls;
      if (c === "distribution" || c === "maitresse") len += n.segments[i].length;
    }
    assert.equal(sec.addresses, Math.round(len / 12));
  }
  assert.equal(
    m.sectors.reduce((a, s) => a + s.segments.length, 0),
    n.segments.length,
  );
  const r = readingsAt(m, T, null);
  assert.equal(r.length, m.sensors.length);
  console.log(`capteurs : ${m.sensors.length} (${rsv.length} réservoirs)`);
});

test("breakHistory : 13C1949 → 3, plus fréquent pour la fonte grise ancienne", () => {
  assert.equal(breakHistory(m, brk), 3);
  const avg = (pred: (i: number) => boolean) => {
    let sum = 0;
    let k = 0;
    for (const s of n.segments) if (pred(s.idx)) (sum += breakHistory(m, s.idx)), k++;
    return sum / k;
  };
  const oldGrey = avg((i) => n.segments[i].material === "fonte-grise" && (n.segments[i].year ?? 2000) < 1950);
  const pvc = avg((i) => n.segments[i].material === "pvc");
  assert.ok(oldGrey > pvc * 3, `${oldGrey} vs ${pvc}`);
});

test("FLUSHING_2026 : un secteur par période de deux semaines, de mai à octobre", () => {
  assert.equal(FLUSHING_2026.length, 10);
  assert.equal(new Set(FLUSHING_2026.map((f) => f.sectorId)).size, 10);
  for (const f of FLUSHING_2026) {
    assert.ok(m.sectors.some((s) => s.id === f.sectorId));
    assert.equal((Date.parse(f.end) - Date.parse(f.start)) / 86_400_000, 13);
  }
  assert.ok(FLUSHING_2026[0].start.startsWith("2026-05"));
  assert.ok(FLUSHING_2026[9].end.startsWith("2026-10"));
});

test("extraTagNodes : points supplémentaires distincts, déterministes", () => {
  const extra = extraTagNodes(m, 80);
  assert.equal(extra.length, 80);
  const used = new Set(m.sensors.map((s) => s.node));
  for (const x of extra) assert.ok(!used.has(x));
  assert.equal(new Set(extra).size, 80);
  assert.deepEqual(extraTagNodes(m, 80), extra);
  assert.deepEqual(extraTagNodes(m, 20), extra.slice(0, 20));
});

test("pointReadings : pression des points supplémentaires, même modèle que les capteurs de pression", () => {
  const t = Date.UTC(2026, 10, 24, 15, 15);
  const p = m.sensors.filter((s) => s.kind === "pression");
  const all = readingsAt(m, t, null);
  assert.deepEqual(
    pointReadings(m, t, null, p.map((s) => s.node)),
    p.map((s) => all[s.idx]),
  );
  const extra = pointReadings(m, t, null, extraTagNodes(m, 20));
  assert.equal(extra.length, 20);
  assert.ok(extra.every((r) => r.unit === "bar" && Number.isFinite(r.value)));
});
