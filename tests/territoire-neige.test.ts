import assert from "node:assert/strict";
import test from "node:test";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { atHour, type EnvAction } from "../src/lib/territoire/day";
import { FLEET } from "../src/lib/territoire/fleet";
import type { Forecast } from "../src/lib/territoire/meteo";
import { banDecision, banTiming, isBan, operationDayOf, snowPlan, snowSource, FLEET as FLEET2, type SnowSource } from "../src/lib/territoire/neige";

const d = SCENARIO_DAY;
const sim: SnowSource = { kind: "simulation", cm: 12 };
const at = (h: string) => atHour(d, h);
const banA: EnvAction = { at: at("08:00"), kind: "ban", zones: ["A"] };
const next = (h: string) => atHour(atHour(d, "12:00") + 24 * 3_600_000, h);
const zone = (t: number, actions: EnvAction[], z: "A" | "B" | "C") => snowPlan(t, actions, sim).find((p) => p.zone === z)!;

const forecast = (snowCm: number | null, warnings: Forecast["warnings"] = []): Forecast => ({
  source: "eccc",
  issuedAt: "",
  current: { tempC: -2, condition: "", iconCode: null },
  periods: [{ name: "Ce soir", summary: "", snowCm, rainMm: null, iconCode: null }],
  hourly: [],
  warnings,
  sun: null,
});

test("FLEET est réexportée de fleet.ts", () => {
  assert.equal(FLEET2, FLEET);
});

test("snowSource : simulation sans prévision ou sous le seuil, eccc sinon", () => {
  assert.equal(snowSource(null).kind, "simulation");
  assert.deepEqual(snowSource(forecast(1)), { kind: "simulation", cm: 12 });
  const s = snowSource(forecast(6));
  assert.equal(s.kind, "eccc");
  assert.equal(s.cm, 6);
  assert.equal(snowSource(forecast(0, [{ title: "AVERTISSEMENT DE NEIGE", type: "warning", expires: "" }])).kind, "eccc");
});

test("00:00 à 06:00 : plan par défaut de la veille, en vigueur", () => {
  const plan = snowPlan(at("02:00"), [], sim);
  assert.equal(plan.length, 3);
  for (const p of plan) {
    assert.equal(p.ban, "en-vigueur");
    assert.equal(p.lights, "allume");
    assert.equal(p.decidedBy, "direction");
  }
  assert.deepEqual(plan.flatMap((p) => p.resources).sort(), FLEET.map((r) => r.id).sort());
  assert.deepEqual(plan[0].resources, FLEET.filter((_, i) => i % 3 === 0).map((r) => r.id));
});

test("R11 : un ban du visiteur à 01:00 change la nuit en cours tout de suite", () => {
  const ban: EnvAction = { at: at("01:00"), kind: "ban", zones: ["A"] };
  // avant la décision : la décision par défaut de la veille, trois zones
  assert.ok(snowPlan(at("00:59"), [ban], sim).every((p) => p.ban === "en-vigueur" && p.decidedBy === "direction"));
  const plan = snowPlan(at("01:00"), [ban], sim);
  assert.deepEqual(plan.map((p) => `${p.zone}:${p.ban}:${p.lights}`), ["A:en-vigueur:allume", "B:aucune:eteint", "C:aucune:eteint"]);
  assert.equal(plan[0].decidedBy, "visiteur");
  assert.equal(plan[0].decidedAt, at("01:00"));
});

test("06:00 à 10:00 : aucune interdiction", () => {
  for (const h of ["06:00", "07:00", "09:00"]) {
    for (const p of snowPlan(at(h), [], sim)) {
      assert.equal(p.ban, "aucune");
      assert.equal(p.lights, "eteint");
      assert.equal(p.decidedBy, null);
      assert.equal(p.decidedAt, null);
    }
  }
});

test("décision par défaut de la direction à 10:00", () => {
  assert.equal(snowPlan(at("09:59"), [], sim)[0].ban, "aucune");
  for (const p of snowPlan(at("10:01"), [], sim)) {
    assert.equal(p.ban, "programmee");
    assert.equal(p.lights, "programme");
    assert.equal(p.decidedBy, "direction");
    assert.equal(p.decidedAt, at("10:00"));
  }
});

test("décision du visiteur : seule la zone A, puis en vigueur à 23:00", () => {
  assert.equal(zone(at("10:01"), [banA], "A").ban, "programmee");
  assert.equal(zone(at("10:01"), [banA], "A").decidedBy, "visiteur");
  assert.equal(zone(at("10:01"), [banA], "A").decidedAt, banA.at);
  assert.equal(zone(at("10:01"), [banA], "B").ban, "aucune");
  assert.equal(zone(at("10:01"), [banA], "C").ban, "aucune");
  const night = zone(at("23:30"), [banA], "A");
  assert.equal(night.ban, "en-vigueur");
  assert.equal(night.lights, "allume");
  assert.equal(zone(at("23:30"), [banA], "B").ban, "aucune");
});

test("retour en arrière : avant l'action, la zone redevient aucune", () => {
  assert.equal(zone(at("07:45"), [banA], "A").ban, "aucune");
});

test("le dernier ban avant 15:00 l'emporte et remplace la décision par défaut", () => {
  const later: EnvAction = { at: at("11:00"), kind: "ban", zones: ["B", "C"] };
  assert.equal(zone(at("12:00"), [banA, later], "A").ban, "aucune");
  assert.equal(zone(at("12:00"), [banA, later], "B").decidedBy, "visiteur");
  const afterDefault = snowPlan(at("11:00"), [later], sim);
  assert.deepEqual(afterDefault.map((p) => p.ban), ["aucune", "programmee", "programmee"]);
});

test("ressources : répartition par défaut puis assign", () => {
  const plan = snowPlan(at("12:00"), [], sim);
  assert.equal(plan[0].resources.length, 8);
  assert.equal(plan[0].resources[0], "CH-01");
  assert.equal(plan[1].resources[0], "CH-02");
  const moved = snowPlan(at("12:00"), [{ at: at("11:00"), kind: "assign", resource: "CH-01", zone: "B" }], sim);
  assert.ok(!moved[0].resources.includes("CH-01"));
  assert.ok(moved[1].resources.includes("CH-01"));
  const off = snowPlan(at("12:00"), [{ at: at("11:00"), kind: "assign", resource: "CH-01", zone: null }], sim);
  assert.ok(off.every((p) => !p.resources.includes("CH-01")));
});

test("progression : nulle avant 23:00, 1 à 05:30 avec 8 ressources", () => {
  assert.equal(zone(at("22:59"), [], "A").progress, 0);
  assert.equal(zone(at("23:00"), [], "A").progress, 0);
  assert.ok(zone(at("23:30"), [], "A").progress > 0);
  assert.equal(zone(at("05:30"), [], "A").progress, 1);
  assert.equal(zone(at("05:45"), [], "A").progress, 1);
});

test("progression : 4 ressources, 0,25 à 02:15 (depuis 23:00 de la veille)", () => {
  const unassign = ["CH-01", "CH-04", "CH-07", "NI-02"].map((resource): EnvAction => ({ at: at("00:30"), kind: "assign", resource, zone: null }));
  const p = zone(at("02:15"), unassign, "A");
  assert.equal(p.resources.length, 4);
  assert.equal(p.progress, 0.25);
});

test("banTiming : avant la prévision, de jour, tardive après 15:00, de nuit dès 23:00 (jamais refusée, R11)", () => {
  assert.equal(banTiming(at("02:00")), "nuit");
  assert.equal(banTiming(at("06:00")), "avant-prevision");
  assert.equal(banTiming(at("07:29")), "avant-prevision");
  assert.equal(banTiming(at("07:30")), "jour");
  assert.equal(banTiming(at("15:00")), "jour");
  assert.equal(banTiming(at("15:01")), "tardive");
  assert.equal(banTiming(at("22:59")), "tardive");
  assert.equal(banTiming(at("23:00")), "nuit");
});

test("operationDayOf : de 06:00 à 06:00 le lendemain", () => {
  assert.equal(operationDayOf(at("06:00")), d);
  assert.equal(operationDayOf(at("23:59")), d);
  assert.equal(operationDayOf(next("05:59")), d);
  assert.equal(operationDayOf(next("06:00")), operationDayOf(next("12:00")));
  assert.notEqual(operationDayOf(next("06:00")), d);
  assert.ok(isBan(banA) && !isBan({ at: at("08:00"), kind: "isolate" }));
});

test("R11 : une décision à 16:00 est acceptée et programme l'interdiction du soir", () => {
  const late: EnvAction = { at: at("16:00"), kind: "ban", zones: ["B"] };
  // avant : la décision par défaut ; après : celle du visiteur, B seule
  assert.ok(snowPlan(at("15:59"), [late], sim).every((p) => p.decidedBy === "direction"));
  const plan = snowPlan(at("16:00"), [late], sim);
  assert.deepEqual(plan.map((p) => `${p.zone}:${p.ban}`), ["A:aucune", "B:programmee", "C:aucune"]);
  assert.deepEqual(snowPlan(at("23:30"), [late], sim).map((p) => `${p.zone}:${p.lights}`), ["A:eteint", "B:allume", "C:eteint"]);
});

test("R11 : une décision à 00:30 change la nuit en cours ; le déneigement d'une zone ajoutée part de la décision", () => {
  const day: EnvAction = { at: at("08:00"), kind: "ban", zones: ["A", "B"] };
  const night: EnvAction = { at: next("00:30"), kind: "ban", zones: ["A", "C"] };
  assert.deepEqual(snowPlan(next("00:29"), [day, night], sim).map((p) => p.ban), ["en-vigueur", "en-vigueur", "aucune"]);
  const plan = snowPlan(next("00:30"), [day, night], sim);
  assert.deepEqual(plan.map((p) => `${p.zone}:${p.ban}:${p.lights}`), ["A:en-vigueur:allume", "B:aucune:eteint", "C:en-vigueur:allume"]);
  assert.equal(plan[0].decidedAt, next("00:30"));
  // A est interdite depuis 23:00 (décision de 08:00 reconduite) ; C, depuis 00:30
  const later = snowPlan(next("01:30"), [day, night], sim);
  const rate = (n: number) => 3_600_000 / ((6.5 * 8 * 3_600_000) / n);
  assert.ok(Math.abs(later[0].progress - 2.5 * rate(later[0].resources.length)) < 1e-9, String(later[0].progress));
  assert.ok(Math.abs(later[2].progress - 1 * rate(later[2].resources.length)) < 1e-9, String(later[2].progress));
  // la décision de nuit ne vaut pas pour la soirée suivante : nouvelle opération dès 06:00
  assert.ok(snowPlan(next("11:00"), [day, night], sim).every((p) => p.decidedBy === "direction"));
});

test("banDecision : celle du visiteur (même sans zone), sinon celle de la direction après 10:00, sinon null", () => {
  assert.equal(banDecision(at("09:00"), []), null);
  assert.deepEqual(banDecision(at("10:30"), []), { by: "direction", at: at("10:00"), zones: ["A", "B", "C"] });
  const none: EnvAction = { at: at("11:00"), kind: "ban", zones: [] };
  assert.deepEqual(banDecision(at("12:00"), [none]), { by: "visiteur", at: at("11:00"), zones: [] });
  // la nuit : la décision « aucune zone » de la veille est toujours celle du visiteur
  assert.deepEqual(banDecision(next("00:30"), [none]), { by: "visiteur", at: at("11:00"), zones: [] });
  assert.ok(snowPlan(next("00:30"), [none], sim).every((p) => p.ban === "aucune"));
});

test("une interdiction ou une réaffectation posée la nuit vaut pour la nuit en cours, pas pour l'opération suivante (R10)", () => {
  const night: EnvAction = { at: at("02:00"), kind: "ban", zones: ["A"] };
  const move: EnvAction = { at: at("02:00"), kind: "assign", resource: "CH-01", zone: "B" };
  // 08:00 : rien de décidé pour ce soir ; 11:00 : décision par défaut
  assert.ok(snowPlan(at("08:00"), [night], sim).every((p) => p.ban === "aucune"));
  assert.ok(snowPlan(at("11:00"), [night], sim).every((p) => p.decidedBy === "direction" && p.ban === "programmee"));
  // pendant la nuit, la réaffectation s'applique ; le jour venu, la répartition par défaut revient
  assert.ok(zone(at("02:30"), [night, move], "B").resources.includes("CH-01"));
  assert.ok(!zone(at("08:00"), [night, move], "B").resources.includes("CH-01"));
  assert.ok(zone(at("08:00"), [night, move], "A").resources.includes("CH-01"));
});

test("R10 : une réaffectation à 03:00 ne s'applique plus à 12:00", () => {
  const move: EnvAction = { at: at("03:00"), kind: "assign", resource: "CH-01", zone: null };
  assert.ok(!snowPlan(at("04:00"), [move], sim).some((p) => p.resources.includes("CH-01")));
  assert.ok(zone(at("12:00"), [move], "A").resources.includes("CH-01"));
  assert.equal(zone(at("12:00"), [move], "A").resources.length, 8);
});

// R10 : de 00:00 à 06:00, c'est l'opération de la veille (jour D → nuit du jour D+1)

test("R10 : un ban A+B à 08:00 le jour D → A et B en vigueur, C sans interdiction à 00:30 le jour D+1, par le visiteur", () => {
  const ban: EnvAction = { at: at("08:00"), kind: "ban", zones: ["A", "B"] };
  const plan = snowPlan(next("00:30"), [ban], sim);
  assert.deepEqual(plan.map((p) => p.ban), ["en-vigueur", "en-vigueur", "aucune"]);
  assert.deepEqual(plan.map((p) => p.lights), ["allume", "allume", "eteint"]);
  for (const p of plan.slice(0, 2)) {
    assert.equal(p.decidedBy, "visiteur");
    assert.equal(p.decidedAt, at("08:00"));
    assert.ok(p.progress > 0);
  }
  assert.equal(plan[2].decidedBy, null);
  assert.equal(plan[2].progress, 0);
});

test("R10 : sans ban du visiteur le jour D, la décision par défaut (10:00, direction) à 00:30 le jour D+1", () => {
  const plan = snowPlan(next("00:30"), [{ at: at("11:00"), kind: "assign", resource: "CH-01", zone: "B" }], sim);
  assert.ok(plan.every((p) => p.ban === "en-vigueur" && p.decidedBy === "direction" && p.decidedAt === at("10:00")));
  // les réaffectations de la veille valent pour la nuit
  assert.ok(plan[1].resources.includes("CH-01"));
});

test("R10 : une réaffectation de nuit (01:00, jour D+1) s'applique, après celles de la veille", () => {
  const actions: EnvAction[] = [
    { at: at("08:00"), kind: "ban", zones: ["A", "B"] },
    { at: at("11:00"), kind: "assign", resource: "CH-01", zone: "B" },
    { at: next("01:00"), kind: "assign", resource: "CH-01", zone: "C" },
  ];
  assert.ok(snowPlan(next("00:30"), actions, sim)[1].resources.includes("CH-01"));
  const plan = snowPlan(next("01:30"), actions, sim);
  assert.ok(plan[2].resources.includes("CH-01"));
  assert.ok(!plan[1].resources.includes("CH-01"));
});

test("R10 : à 06:00 le jour D+1, les actions du jour D ne comptent plus", () => {
  const actions: EnvAction[] = [
    { at: at("08:00"), kind: "ban", zones: ["A"] },
    { at: at("11:00"), kind: "assign", resource: "CH-01", zone: "B" },
  ];
  assert.ok(snowPlan(next("06:00"), actions, sim).every((p) => p.ban === "aucune"));
  assert.ok(snowPlan(next("11:00"), actions, sim).every((p) => p.decidedBy === "direction"));
  assert.ok(snowPlan(next("11:00"), actions, sim)[0].resources.includes("CH-01"));
});
