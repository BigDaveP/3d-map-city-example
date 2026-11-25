import assert from "node:assert/strict";
import test from "node:test";
import { actionsUpTo, atHour, dayStartOf, nextEvents, type EnvAction } from "../src/lib/territoire/day";
import { ENVS } from "../src/lib/territoire/envs";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";

const H = 3_600_000;

test("dayStartOf : minuit local (UTC−5 en novembre)", () => {
  assert.equal(dayStartOf(Date.UTC(2026, 10, 24, 7, 30)), Date.UTC(2026, 10, 24, 5, 0));
  assert.equal(dayStartOf(SCENARIO_DAY), SCENARIO_DAY);
});

test("dayStartOf : le jour du changement d'heure (8 mars 2026) dure 23 h", () => {
  const t = Date.UTC(2026, 2, 8, 12);
  const next = dayStartOf(t + 24 * H);
  assert.equal(next - dayStartOf(t), 23 * H);
});

test("dayStartOf : le jour du retour à l'heure normale (1er nov. 2026) dure 25 h", () => {
  const t = Date.UTC(2026, 10, 1, 12);
  assert.equal(dayStartOf(t + 24 * H) - dayStartOf(t), 25 * H);
});

test("atHour : heure locale de la journée, sans erreur au changement d'heure", () => {
  assert.equal(atHour(SCENARIO_DAY, "14:00") - SCENARIO_DAY, 14 * H);
  const dst = dayStartOf(Date.UTC(2026, 2, 8, 12));
  assert.equal(atHour(dst, "14:00"), Date.UTC(2026, 2, 8, 18, 0)); // UTC−4 après le changement
  assert.equal(atHour(dst, "01:30") - dst, 1.5 * H);
});

test("actionsUpTo : écarte la veille et le futur", () => {
  const d = SCENARIO_DAY;
  const t = atHour(d, "12:00");
  const yesterday: EnvAction = { at: atHour(d - 12 * H, "23:00"), kind: "isolate" };
  const ok: EnvAction = { at: atHour(d, "10:00"), kind: "ban", zones: ["A"] };
  const later: EnvAction = { at: atHour(d, "13:00"), kind: "assign", resource: "R1", zone: "B" };
  assert.deepEqual(actionsUpTo([yesterday, ok, later], t), [ok]);
  assert.deepEqual(actionsUpTo([ok, later], atHour(d, "13:00")), [ok, later]);
});

test("nextEvents : prochains événements dans l'ordre", () => {
  const d = SCENARIO_DAY;
  assert.deepEqual(
    nextEvents(atHour(d, "08:00"), 2).map((e) => e.label),
    ["Décision par défaut de l'interdiction (10 h)", "Bris de conduite au centre-ville (14 h)"],
  );
  const late = nextEvents(atHour(d, "23:30"), 2);
  assert.equal(late[0].at, atHour(d + 36 * H, "06:00"));
  assert.ok(late[0].at < late[1].at);
  assert.equal(nextEvents(atHour(d, "08:00"), 2)[1].env, "aqueduc");
});

test("ENVS : cinq environnements, deux au lot 1", () => {
  assert.deepEqual(Object.keys(ENVS), ["aqueduc", "deneigement", "collecte", "zonage", "evaluation"]);
  assert.deepEqual(Object.entries(ENVS).filter(([, e]) => e.lot === 1).map(([k]) => k), ["aqueduc", "deneigement"]);
});
