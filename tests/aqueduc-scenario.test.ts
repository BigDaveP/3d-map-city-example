import assert from "node:assert/strict";
import { test } from "node:test";
import { closeValvesAction } from "../src/app/aqueduc-actions";
import { GET as getNetwork } from "../src/app/api/aqueduc/network/route";
import { isolate, isolationPath } from "../src/lib/aqueduc/graph";
import { SCENARIO_DAY, SCENARIO_STEPS, scenarioIncident, scenarioIncidentParams, stepAtTime } from "../src/lib/aqueduc/scenario";
import { indexNetwork } from "../src/client/aqueduc/net";
import type { NetworkData } from "../src/client/aqueduc/pipes";
import { cutLayout, valveLabel, VALVE_AT } from "../src/client/aqueduc/scene/cut";
import { aqueducStore, simNow } from "../src/client/aqueduc/store";
import {
  attachScenario,
  closeValves,
  exploreFreely,
  faceBearing,
  goToStep,
  nextStep,
  prevStep,
  seekTo,
  startScenario,
  STEP_VIEW,
  turnValve,
} from "../src/client/aqueduc/scenarioController";
import { CITY } from "../src/lib/aqueduc/city";
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

// ---------------------------------------------------------------- Task 9 : scénario guidé (client)

const iso = isolate(n, brk, m.valves);
const STEPS = SCENARIO_STEPS.map((s) => s.id);

test("scenarioIncidentParams : même incident que scenarioIncident, sans le modèle (client)", () => {
  for (const id of STEPS)
    for (const closed of [false, true]) {
      const { segment, ...ref } = scenarioIncident(id, closed, m);
      assert.equal(segment, brk);
      assert.deepEqual(scenarioIncidentParams(id, closed, iso.valves), ref, `${id} ${closed}`);
    }
});

test("stepAtTime : étape en cours à une heure du scénario", () => {
  assert.equal(stepAtTime(SCENARIO_DAY), "detection");
  for (const s of SCENARIO_STEPS) {
    assert.equal(stepAtTime(s.at), s.id);
    assert.equal(stepAtTime(s.at + 60_000), s.id);
  }
  assert.equal(stepAtTime(step("isolation").at - 1), "detection");
});

test("isolationPath : de vanne à vanne le long des tronçons isolés, avec un tronçon hors zone de chaque côté", () => {
  const p = isolationPath(n, iso)!;
  assert.ok(p);
  assert.deepEqual([p.from, p.to].sort((a, b) => a - b), iso.valves);
  assert.ok(p.segments.includes(brk));
  assert.deepEqual([...p.segments].sort((a, b) => a - b), iso.isolated.filter((si) => n.segments[si].cls !== "branchement"));
  // chaîne continue de p.from à p.to
  let node = p.from;
  for (const si of p.segments) {
    const s = n.segments[si];
    assert.ok(s.a === node || s.b === node, `rupture au tronçon ${s.id}`);
    node = s.a === node ? s.b : s.a;
  }
  assert.equal(node, p.to);
  for (const [v, si] of [[p.from, p.before], [p.to, p.after]] as const) {
    assert.ok(si !== null);
    const s = n.segments[si!];
    assert.ok(s.a === v || s.b === v);
    assert.ok(!iso.isolated.includes(si!));
    assert.notEqual(s.cls, "branchement");
  }
});

// réseau tel que le client le reçoit
const data = (await (await getNetwork()).json()) as NetworkData;
const net = indexNetwork(data);

test("network : plan d'isolation du scénario calculé par le serveur", () => {
  assert.equal(data.scenario.segment, CITY.breakSegment);
  assert.deepEqual(data.scenario.valves, iso.valves);
  assert.deepEqual(data.scenario.isolated, iso.isolated);
  assert.deepEqual(data.scenario.path, isolationPath(n, iso));
  const open = incidentImpact(m, step("isolation").at, scenarioIncident("isolation", false, m));
  const shut = incidentImpact(m, step("isolation").at, scenarioIncident("isolation", true, m));
  assert.deepEqual(data.scenario.impact, { lowPressure: open.lowPressureAddresses, withoutWater: shut.withoutWaterAddresses });
});

test("cutLayout : coupe de vanne à vanne, vannes à 15 % et 85 % de la largeur, profil de pression ordonné", () => {
  const c = cutLayout(net)!;
  assert.ok(c);
  assert.deepEqual(VALVE_AT, [0.15, 0.85]);
  const xs = c.valves.map((v) => v.x).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - 0.15) < 1e-9 && Math.abs(xs[1] - 0.85) < 1e-9, `vannes ${xs}`);
  assert.deepEqual(new Set(c.valves.map((v) => v.node)), new Set(iso.valves));
  // libellé : rang de la vanne dans l'inventaire (simulé) trié
  for (const v of c.valves) assert.equal(v.label, `V-${data.valves.findIndex((x) => x.node === v.node) + 1}`);
  assert.equal(valveLabel(net, c.valves[0].node), c.valves[0].label);
  assert.ok(c.spanM > 40 && c.spanM < 120, `vanne à vanne ${c.spanM} m`);
  assert.ok(Math.abs(c.lengthM - c.spanM / 0.7) < 1e-6);
  assert.ok(c.breakX > xs[0] && c.breakX < xs[1], `bris à ${c.breakX}`);
  // profil : tronçon hors zone à chaque bord, tronçons isolés entre les vannes
  assert.equal(c.points[0].x, 0);
  assert.equal(c.points[c.points.length - 1].x, 1);
  for (let i = 1; i < c.points.length; i++) assert.ok(c.points[i].x >= c.points[i - 1].x);
  assert.ok(c.points.some((p) => p.seg === brk));
  assert.ok(c.points.slice(1, -1).every((p) => p.x >= xs[0] - 1e-9 && p.x <= xs[1] + 1e-9));
});

// ---- contrôleur (sans React) : le scénario pilote `clock`, `scenario`, `incident` et la sélection
const views: string[] = [];
const detach = attachScenario({ valves: data.scenario.valves, camera: (v) => views.push(v) });
const NOW = Date.UTC(2026, 10, 24, 20, 0);
const reset = () =>
  aqueducStore.setState({
    mode: "hic",
    layer: "age",
    underground: false,
    selection: null,
    clock: { t0: Date.UTC(2026, 10, 24, 19, 30), speed: 60, startedAt: NOW - 60_000 },
    scenario: { active: false, step: "detection", valvesClosed: false, resumeAt: null, resumeSpeed: 1, resumeLayer: "pression", resumeUnderground: false, valvesTurned: [], error: "" },
    incident: null,
  });

test("startScenario : horloge du scénario, incident de l'étape, couche Pression, heure quittée retenue", () => {
  reset();
  views.length = 0;
  const left = simNow(NOW);
  startScenario(NOW);
  const s = aqueducStore.getState();
  assert.equal(s.scenario.active, true);
  assert.equal(s.scenario.step, "detection");
  assert.equal(s.scenario.resumeAt, left);
  assert.equal(s.scenario.resumeSpeed, 60);
  assert.equal(s.scenario.resumeLayer, "age");
  assert.equal(s.layer, "pression");
  assert.equal(s.clock.t0, step("detection").at);
  assert.equal(s.clock.startedAt, NOW);
  // la ligne de temps du scénario avance en temps réel, quelle que soit la vitesse quittée (×60)
  assert.equal(s.clock.speed, 1);
  assert.deepEqual(s.incident, scenarioIncidentParams("detection", false, iso.valves));
  assert.deepEqual(views, ["start", "detection"]);
  // relancer pendant le scénario garde l'heure quittée
  goToStep("rapport", NOW + 5_000);
  startScenario(NOW + 10_000);
  assert.equal(aqueducStore.getState().scenario.resumeAt, left);
  assert.equal(aqueducStore.getState().scenario.step, "detection");
});

test("vue souterraine : coupée pendant le scénario (couches masquées, sans mention), rendue à la sortie", () => {
  reset();
  aqueducStore.setState({ underground: true });
  startScenario(NOW);
  assert.equal(aqueducStore.getState().underground, false);
  assert.equal(aqueducStore.getState().scenario.resumeUnderground, true);
  // relancer pendant le scénario garde la valeur quittée
  startScenario(NOW + 1000);
  assert.equal(aqueducStore.getState().scenario.resumeUnderground, true);
  exploreFreely(NOW + 2000);
  assert.equal(aqueducStore.getState().underground, true);
  assert.equal(aqueducStore.getState().scenario.resumeUnderground, false);
  // vue normale quittée : reste normale
  reset();
  startScenario(NOW);
  exploreFreely(NOW + 1000);
  assert.equal(aqueducStore.getState().underground, false);
});

test("goToStep : incident reconstruit à chaque étape, caméra de l'étape, coupe seule en HIC", () => {
  reset();
  startScenario(NOW);
  views.length = 0;
  for (const id of STEPS) {
    goToStep(id, NOW + 1000);
    const s = aqueducStore.getState();
    assert.equal(s.scenario.step, id);
    assert.equal(s.clock.t0, step(id).at);
    assert.deepEqual(s.incident, scenarioIncidentParams(id, false, iso.valves));
    // en HIC, la coupe est dans la scène : pas de fiche ouverte d'office
    assert.equal(s.selection, null);
  }
  assert.deepEqual(views, STEPS);
  for (const id of STEPS) assert.ok(STEP_VIEW[id].zoom > 0);
  assert.equal(STEP_VIEW.isolation.pitch, 70);
  // en mode classique, la coupe est dans la fiche : l'isolation ouvre la fiche de l'incident
  aqueducStore.setState({ mode: "classic" });
  goToStep("isolation", NOW + 2000);
  assert.deepEqual(aqueducStore.getState().selection, { kind: "incident", id: CITY.breakSegment });
  // changer de mode pendant l'isolation suit la même règle
  aqueducStore.setState({ mode: "hic" });
  assert.equal(aqueducStore.getState().selection, null);
  aqueducStore.setState({ mode: "classic" });
  assert.deepEqual(aqueducStore.getState().selection, { kind: "incident", id: CITY.breakSegment });
  nextStep(NOW + 3000);
  assert.equal(aqueducStore.getState().scenario.step, "intervention");
  prevStep(NOW + 4000);
  assert.equal(aqueducStore.getState().scenario.step, "isolation");
  prevStep(NOW + 4000);
  prevStep(NOW + 4000);
  assert.equal(aqueducStore.getState().scenario.step, "detection");
});

test("exploreFreely après l'isolation : réseau vivant à l'heure quittée, scénario vidé", () => {
  reset();
  const left = simNow(NOW);
  startScenario(NOW);
  goToStep("isolation", NOW + 1000);
  assert.equal(aqueducStore.getState().clock.speed, 1);
  aqueducStore.setState({ selection: { kind: "incident", id: CITY.breakSegment } });
  views.length = 0;
  exploreFreely(NOW + 90_000);
  const s = aqueducStore.getState();
  assert.equal(s.scenario.active, false);
  assert.equal(s.scenario.resumeAt, null);
  assert.equal(s.clock.t0, left);
  assert.equal(s.clock.speed, 60);
  assert.equal(s.clock.startedAt, NOW + 90_000);
  assert.equal(s.incident, null);
  assert.equal(s.selection, null);
  assert.equal(s.layer, "age");
  assert.deepEqual(views, ["exit"]);
  // hors scénario : sans effet
  exploreFreely(NOW + 100_000);
  goToStep("rapport", NOW + 100_000);
  assert.equal(aqueducStore.getState().scenario.active, false);
  assert.equal(aqueducStore.getState().incident, null);
});

test("seekTo pendant le scénario : étape de l'heure visée, incident reconstruit (jamais un incident figé)", () => {
  reset();
  startScenario(NOW);
  goToStep("intervention", NOW);
  seekTo(step("isolation").at + 5 * 60_000, NOW + 1000);
  let s = aqueducStore.getState();
  assert.equal(s.scenario.step, "isolation");
  assert.equal(s.clock.t0, step("isolation").at + 5 * 60_000);
  assert.deepEqual(s.incident!.closedValves, []);
  seekTo(step("retablissement").at + 60_000, NOW + 2000);
  s = aqueducStore.getState();
  assert.equal(s.scenario.step, "retablissement");
  assert.equal(s.incident!.restoredAt, step("retablissement").at);
  exploreFreely(NOW + 3000);
  // hors scénario : simple déplacement de l'horloge
  seekTo(NOW - 3_600_000, NOW + 4000);
  assert.equal(aqueducStore.getState().clock.t0, NOW - 3_600_000);
  assert.equal(aqueducStore.getState().incident, null);
});

test("vannes de la coupe : les deux fermées → action serveur, incident « sans eau », fiche ouverte", async () => {
  reset();
  startScenario(NOW);
  goToStep("isolation", NOW);
  const calls: [string, number[]][] = [];
  const action = async (seg: string, nodes: number[]) => {
    calls.push([seg, nodes]);
    return closeValvesAction(seg, nodes);
  };
  const [a, b] = data.scenario.valves;
  assert.equal(await turnValve(a, action), null);
  assert.deepEqual(aqueducStore.getState().scenario.valvesTurned, [a]);
  assert.equal(calls.length, 0);
  // un second clic sur la même vanne la rouvre
  await turnValve(a, action);
  assert.deepEqual(aqueducStore.getState().scenario.valvesTurned, []);
  await turnValve(a, action);
  const r = await turnValve(b, action);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, [[CITY.breakSegment, [a, b]]]);
  const s = aqueducStore.getState();
  assert.equal(s.scenario.valvesClosed, true);
  assert.deepEqual(s.incident, scenarioIncidentParams("isolation", true, iso.valves));
  assert.deepEqual(s.selection, { kind: "incident", id: CITY.breakSegment });
  // l'incident fermé prive d'eau le tronçon isolé (même calcul que le serveur)
  const imp = incidentImpact(m, step("isolation").at, { segment: brk, ...s.incident! });
  assert.equal(imp.withoutWaterAddresses, data.scenario.impact.withoutWater);
  assert.equal(imp.lowPressureAddresses, 0);
});

test("vannes : refus ou erreur du serveur → vannes rouvertes, message, incident inchangé", async () => {
  reset();
  startScenario(NOW);
  goToStep("isolation", NOW);
  const before = aqueducStore.getState().incident;
  const [a, b] = data.scenario.valves;
  await turnValve(a, async () => ({ ok: false, reason: "refusé" }));
  const r = await turnValve(b, async () => ({ ok: false as const, reason: "Vanne étrangère" }));
  assert.deepEqual(r, { ok: false, reason: "Vanne étrangère" });
  let s = aqueducStore.getState();
  assert.equal(s.scenario.valvesClosed, false);
  assert.deepEqual(s.scenario.valvesTurned, []);
  assert.match(s.scenario.error, /Vanne étrangère/);
  assert.equal(s.incident, before);
  await turnValve(a);
  const thrown = await turnValve(b, async () => {
    throw new Error("réseau");
  });
  assert.equal(thrown?.ok, false);
  s = aqueducStore.getState();
  assert.equal(s.scenario.valvesClosed, false);
  assert.match(s.scenario.error, /n'a pas pu/);
  // hors de l'étape d'isolation, les vannes ne se manœuvrent pas
  goToStep("detection", NOW);
  assert.equal((await closeValves())?.ok, false);
  detach();
});

test("faceBearing : cap qui voit la coupe de face (corde de 13C1949 à 34° d'azimut)", () => {
  const c = cutLayout(net)!;
  const b = faceBearing(c.from, c.to);
  assert.ok(Math.abs(b - 124) < 3, `cap ${b}`);
  // la vue de l'isolation garde la coupe lisible : entre 15° et 40° de la vue de face
  assert.ok(Math.abs(STEP_VIEW.isolation.bearing) >= 15 && Math.abs(STEP_VIEW.isolation.bearing) <= 40);
  assert.equal(faceBearing(c.to, c.from), b);
  assert.equal(faceBearing([0, 0], [0, 1]), 90);
});
