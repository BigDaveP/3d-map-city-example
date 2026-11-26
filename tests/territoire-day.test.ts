import assert from "node:assert/strict";
import test from "node:test";
import { actionsUpTo, atHour, dayEndOf, dayEvents, dayStartOf, DAY_TIMES, isLot1Event, nextEvents, type EnvAction } from "../src/lib/territoire/day";
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

test("dayEndOf : minuit suivant, journée de 24 h, 23 h ou 25 h", () => {
  assert.equal(dayEndOf(atHour(SCENARIO_DAY, "14:00")) - SCENARIO_DAY, 24 * H);
  assert.equal(dayEndOf(Date.UTC(2026, 2, 8, 12)) - dayStartOf(Date.UTC(2026, 2, 8, 12)), 23 * H);
  assert.equal(dayEndOf(Date.UTC(2026, 10, 1, 12)) - dayStartOf(Date.UTC(2026, 10, 1, 12)), 25 * H);
});

test("dayEvents : les événements scénarisés de la journée, dans l'ordre, à l'heure locale", () => {
  const ev = dayEvents(SCENARIO_DAY);
  assert.deepEqual(
    ev.map((e) => e.time),
    [DAY_TIMES.banEnd, DAY_TIMES.collecteStart, DAY_TIMES.forecastAt, DAY_TIMES.defaultDecisionAt, DAY_TIMES.breakAt, DAY_TIMES.decisionDeadline, DAY_TIMES.snowStart, DAY_TIMES.banStart],
  );
  for (const e of ev) assert.equal(e.at, atHour(SCENARIO_DAY, e.time));
  assert.equal(ev.find((e) => e.time === "14:00")?.env, "aqueduc");
  assert.ok(ev.every((e) => e.label.length > 0));
  // le jour du changement d'heure, 23:00 est à 24 h − 1 h du minuit local (journée de 25 h)
  const fall = dayStartOf(Date.UTC(2026, 10, 1, 12));
  assert.equal(dayEvents(fall).at(-1)!.at - fall, 24 * H);
});

test("isLot1Event : la collecte (lot 2) reste dans le modèle, mais est écartée de l'accueil et de la frise", () => {
  const all = dayEvents(SCENARIO_DAY);
  assert.ok(all.some((e) => e.id === "collecteStart" && e.env === "collecte"));
  const lot1 = dayEvents(SCENARIO_DAY, isLot1Event);
  assert.equal(lot1.length, all.length - 1);
  assert.ok(lot1.every((e) => e.env !== "collecte"));
  assert.equal(nextEvents(atHour(SCENARIO_DAY, "06:30"), 1)[0].id, "collecteStart");
  assert.equal(nextEvents(atHour(SCENARIO_DAY, "06:30"), 1, isLot1Event)[0].id, "forecastAt");
});
