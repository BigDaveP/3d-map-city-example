import assert from "node:assert/strict";
import { test } from "node:test";
import { benchTags, convexOverlap, impactBySector, inBox, isExtraTag, LAYER_KINDS, pickTags, sectorFigure, TAG_MAX } from "../src/client/aqueduc/scene/marks";
import { CITY, extraTagId } from "../src/lib/aqueduc/city";
import { isolate } from "../src/lib/aqueduc/graph";
import { segmentsInBox } from "../src/lib/aqueduc/network";
import { buildModel, extraTagNodes, incidentImpact, segmentValues, THRESHOLDS, type IncidentInput } from "../src/lib/aqueduc/sim";
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

// --- étiquettes pertinentes (R13) : capteurs de la couche active, alertes, sélection ; 8 au plus
const kinds = ["pression", "debit", "qualite", "reservoir"] as const;
/** 40 capteurs factices sur une ligne vers l'est : le k-ième à k × 50 m du centre */
const fake = Array.from({ length: 40 }, (_, k) => ({ id: `S-${k}`, idx: k, kind: kinds[k % 4], at: [-72.54 + (k * 50) / 76_900, 46.34] as [number, number] }));
const center: [number, number] = [-72.54, 46.34];
const box: [number, number, number, number] = [-73, 46, -72, 47];
const ok = new Array(40).fill(0);
const kindOf = (id: string) => fake.find((s) => s.id === id)!.kind;

test("pickTags : seuls les capteurs de la couche active (pression → pression, débit, réservoir ; qualité → qualité ; sinon aucun)", () => {
  assert.deepEqual(LAYER_KINDS.pression, ["pression", "debit", "reservoir"]);
  const p = pickTags(fake, { layer: "pression", status: ok, selected: null, center, box });
  assert.ok(p.length > 0 && p.every((id) => LAYER_KINDS.pression.includes(kindOf(id))), p.join());
  const q = pickTags(fake, { layer: "qualite", status: ok, selected: null, center, box });
  assert.ok(q.length > 0 && q.every((id) => kindOf(id) === "qualite"), q.join());
  for (const layer of ["age", "rincage", "incidents"] as const) assert.deepEqual(pickTags(fake, { layer, status: ok, selected: null, center, box }), []);
});

test("pickTags : 8 au plus, les plus proches du centre de la vue d'abord", () => {
  const p = pickTags(fake, { layer: "pression", status: ok, selected: null, center, box });
  assert.equal(p.length, TAG_MAX);
  assert.equal(TAG_MAX, 8);
  const near = fake.filter((s) => s.kind !== "qualite").slice(0, 8).map((s) => s.id);
  assert.deepEqual([...p].sort(), [...near].sort());
});

test("pickTags : une alerte ou une attention s'affiche quelle que soit la couche, la sélection aussi", () => {
  const status = [...ok];
  status[39] = 2; // le plus loin, en alerte
  status[38] = 1; // en attention
  for (const layer of ["pression", "age"] as const) {
    const p = pickTags(fake, { layer, status, selected: "S-37", center, box });
    for (const id of ["S-39", "S-38", "S-37"]) assert.ok(p.includes(id), `${layer} : ${id} manquant (${p.join()})`);
    assert.ok(p.length <= TAG_MAX);
  }
  // hors de demoBox : seule la sélection passe
  const far = pickTags(fake, { layer: "pression", status: ok, selected: "S-3", center, box: [0, 0, 1, 1] });
  assert.deepEqual(far, ["S-3"]);
});

test("pickTags : l'alerte passe avant l'attention (une alerte lointaine n'est jamais évincée par 8 attentions proches)", () => {
  const status = [...ok];
  for (let k = 0; k < 9; k++) status[k] = 1;
  status[39] = 2;
  const p = pickTags(fake, { layer: "age", status, selected: null, center, box });
  assert.equal(p.length, TAG_MAX);
  assert.equal(p[0], "S-39");
});

test("pickTags : une étiquette qui recouvrirait le chiffre d'un marquage est écartée (sauf la sélection)", () => {
  const covered = (id: string) => id === "S-0" || id === "S-1";
  const p = pickTags(fake, { layer: "pression", status: ok, selected: "S-1", center, box, covered });
  assert.ok(!p.includes("S-0") && p.includes("S-1"), p.join());
  assert.equal(p.length, TAG_MAX);
});

test("convexOverlap : rectangles et quadrilatères à l'écran", () => {
  const sq = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  assert.ok(convexOverlap(sq(0, 0, 10, 10), sq(5, 5, 10, 10)));
  assert.ok(!convexOverlap(sq(0, 0, 10, 10), sq(11, 0, 10, 10)));
  // bande diagonale qui passe à côté du coin du carré : la boîte englobante se recouvre, pas la bande
  const band: [number, number][] = [[20, 0], [30, 0], [0, 30], [-10, 30]];
  assert.ok(!convexOverlap(sq(16, 16, 10, 10), band));
  assert.ok(convexOverlap(sq(8, 8, 6, 6), band));
});

test("benchTags (R7) : n étiquettes, capteurs réels de la zone d'abord, puis points simulés, sans plafond", () => {
  const pos = (node: number) => {
    const s = n.segments[n.adj[node][0]];
    const k = s.a === node ? 0 : s.coords.length - 2;
    return [s.coords[k], s.coords[k + 1]] as [number, number];
  };
  const extra = extraTagNodes(m, 120).map((node, k) => ({ id: extraTagId(k), at: pos(node) }));
  const inside = m.sensors.filter((s) => inBox(s.at, CITY.demoBox)).length;
  for (const k of [20, 60, 120]) {
    const ids = benchTags(m.sensors, extra, k, CITY.center, CITY.demoBox);
    assert.equal(ids.length, k);
    assert.equal(new Set(ids).size, k);
    const firstExtra = ids.findIndex(isExtraTag);
    // réels d'abord (tous ceux de la zone avant le premier point simulé)
    if (firstExtra >= 0) assert.equal(firstExtra, inside);
    assert.ok(ids.slice(0, Math.min(k, inside)).every((id) => !isExtraTag(id)));
  }
  assert.ok(inside < 60, `capteurs réels dans la zone : ${inside}`);
  assert.ok(TAG_MAX < 20);
});
