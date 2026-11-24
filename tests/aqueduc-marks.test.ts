import assert from "node:assert/strict";
import { test } from "node:test";
import { impactBySector, inBox, sectorFigure } from "../src/client/aqueduc/scene/marks";
import { CITY } from "../src/lib/aqueduc/city";
import { isolate } from "../src/lib/aqueduc/graph";
import { segmentsInBox } from "../src/lib/aqueduc/network";
import { buildModel, incidentImpact, segmentValues, THRESHOLDS, type IncidentInput } from "../src/lib/aqueduc/sim";
import { loadNetwork } from "./aqueduc-fixture";

const n = loadNetwork();
const m = buildModel(n, CITY);
const brk = n.byId.get(CITY.breakSegment)!;
const demo = segmentsInBox(n, CITY.demoBox);
// propriétés envoyées au client par /api/aqueduc/network
const props = n.segments.map((s) => ({ c: s.cls, s: m.sectors[m.sectorOf[s.idx]].id, l: s.length }));
const T = Date.UTC(2026, 10, 24, 15, 15);
/** pression telle que le flux l'envoie : segments de demoBox, 2 décimales */
const streamed = (inc: IncidentInput | null, t: number) => {
  const p = segmentValues(m, t, inc, "pression");
  return Float32Array.from(demo.map((si) => Math.round(p[si] * 100) / 100));
};
const total = (map: Map<string, { low: number; dry: number }>) => [...map.values()].reduce((a, v) => ({ low: a.low + v.low, dry: a.dry + v.dry }), { low: 0, dry: 0 });

test("impactBySector : mêmes adresses que incidentImpact, à partir du flux seulement (avant isolation)", () => {
  const inc: IncidentInput = { segment: brk, startedAt: T, closedValves: [], restoredAt: null };
  const t = T + 5 * 60_000;
  const ref = incidentImpact(m, t, inc);
  const by = impactBySector(props, demo, streamed(inc, t), THRESHOLDS.pressureMin);
  const sum = total(by);
  assert.ok(ref.lowPressureAddresses > 0);
  // arrondi par secteur : au plus une adresse d'écart par secteur touché
  assert.ok(Math.abs(sum.low - ref.lowPressureAddresses) <= by.size, `${sum.low} vs ${ref.lowPressureAddresses}`);
  assert.equal(sum.dry, 0);
  // le secteur du bris est touché
  assert.ok((by.get(m.sectors[m.sectorOf[brk]].id)?.low ?? 0) > 0);
});

test("impactBySector : après isolation, seulement des adresses sans eau", () => {
  const inc: IncidentInput = { segment: brk, startedAt: T, closedValves: isolate(n, brk, m.valves).valves, restoredAt: null };
  const t = T + 30 * 60_000;
  const ref = incidentImpact(m, t, inc);
  const sum = total(impactBySector(props, demo, streamed(inc, t), THRESHOLDS.pressureMin));
  assert.ok(ref.withoutWaterAddresses > 0);
  assert.ok(Math.abs(sum.dry - ref.withoutWaterAddresses) <= 1, `${sum.dry} vs ${ref.withoutWaterAddresses}`);
  assert.equal(sum.low, ref.lowPressureAddresses);
});

test("sectorFigure : un seul chiffre, l'incident d'abord (sans eau, puis basse pression), sinon les adresses desservies", () => {
  assert.deepEqual(sectorFigure(2417, undefined), { value: 2417, label: "adresses desservies", tone: "good" });
  assert.deepEqual(sectorFigure(2411, { low: 0, dry: 6 }), { value: 6, label: "adresses sans eau", tone: "bad" });
  assert.deepEqual(sectorFigure(2417, { low: 61, dry: 0 }), { value: 61, label: "adresses en basse pression", tone: "warn" });
  assert.deepEqual(sectorFigure(2417, { low: 0, dry: 0 }), { value: 2417, label: "adresses desservies", tone: "good" });
});

test("inBox : seuls les capteurs de demoBox portent une étiquette", () => {
  assert.ok(inBox(CITY.center, CITY.demoBox));
  assert.ok(!inBox([-72.68, 46.295], CITY.demoBox));
  const tagged = m.sensors.filter((s) => inBox(s.at, CITY.demoBox));
  assert.ok(tagged.length > 10 && tagged.length < m.sensors.length, `${tagged.length} / ${m.sensors.length}`);
  assert.ok(tagged.some((s) => s.id === "P-01"));
});
