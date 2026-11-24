import assert from "node:assert/strict";
import { test } from "node:test";
import { CITY } from "../src/lib/aqueduc/city";
import { isolate } from "../src/lib/aqueduc/graph";
import { SCENARIO_DAY, SCENARIO_STEPS, scenarioIncident } from "../src/lib/aqueduc/scenario";
import { buildModel, incidentImpact, readingsAt, THRESHOLDS } from "../src/lib/aqueduc/sim";
import { loadNetwork } from "./aqueduc-fixture";

const n = loadNetwork();
const m = buildModel(n, CITY);
const brk = n.byId.get(CITY.breakSegment)!;
const P01 = m.sensors.find((s) => s.id === "P-01")!;
const step = (id: string) => SCENARIO_STEPS.find((s) => s.id === id)!;
/** heure locale (UTC−5 en novembre) au format HH:MM */
const local = (t: number) => new Date(t - 5 * 3_600_000).toISOString().slice(11, 16);

test("étapes dans l'ordre, détection à 06:58", () => {
  assert.equal(local(SCENARIO_DAY), "06:00");
  assert.deepEqual(
    SCENARIO_STEPS.map((s) => s.id),
    ["detection", "isolation", "intervention", "retablissement", "rapport"],
  );
  for (let i = 1; i < SCENARIO_STEPS.length; i++) assert.ok(SCENARIO_STEPS[i].at > SCENARIO_STEPS[i - 1].at);
  assert.equal(local(step("detection").at), "06:58");
  for (const s of SCENARIO_STEPS) assert.ok(s.title.length > 0 && s.text.length > 0);
  // à la détection, P-01 est déjà en alerte
  const inc = scenarioIncident("detection", false, m);
  assert.equal(inc.segment, brk);
  assert.ok(inc.startedAt < step("detection").at);
  assert.equal(readingsAt(m, step("detection").at, inc)[P01.idx].status, "alerte");
});

test("isolation sans vannes fermées : pression basse autour du bris", () => {
  const inc = scenarioIncident("isolation", false, m);
  assert.deepEqual(inc.closedValves, []);
  assert.equal(inc.restoredAt, null);
  const t = step("isolation").at;
  const p = readingsAt(m, t, inc)[P01.idx];
  assert.ok(p.value < THRESHOLDS.pressureMin);
  const imp = incidentImpact(m, t, inc);
  assert.ok(imp.lowPressureAddresses > 0);
  assert.equal(imp.withoutWaterAddresses, 0);
});

test("isolation avec vannes fermées, puis rétablissement et rapport", () => {
  const iso = isolate(n, brk, m.valves);
  const closed = scenarioIncident("isolation", true, m);
  assert.deepEqual(closed.closedValves, iso.valves);
  const imp = incidentImpact(m, step("isolation").at, closed);
  assert.ok(imp.withoutWaterAddresses > 0);
  // après l'isolation, l'équipe a fermé les vannes quoi qu'il arrive
  assert.deepEqual(scenarioIncident("intervention", false, m).closedValves, iso.valves);
  assert.equal(scenarioIncident("intervention", true, m).restoredAt, null);
  const ret = scenarioIncident("retablissement", true, m);
  assert.equal(ret.restoredAt, step("retablissement").at);
  assert.equal(scenarioIncident("rapport", true, m).restoredAt, step("retablissement").at);
  // au rapport, la turbidité est redescendue sous 0,3 UTN (plus de 2 h après la remise en eau)
  assert.ok(step("rapport").at - step("retablissement").at >= 2 * 3_600_000);
  // toutes les étapes partagent le même début d'incident
  const starts = new Set(SCENARIO_STEPS.map((s) => scenarioIncident(s.id, true, m).startedAt));
  assert.equal(starts.size, 1);
});
