import assert from "node:assert/strict";
import test from "node:test";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { atHour, type EnvAction } from "../src/lib/territoire/day";
import { FLEET } from "../src/lib/territoire/fleet";
import type { Forecast } from "../src/lib/territoire/meteo";
import { banDeadlinePassed, banWindow, isDayBan, snowPlan, snowSource, FLEET as FLEET2, type SnowSource } from "../src/lib/territoire/neige";

const d = SCENARIO_DAY;
const sim: SnowSource = { kind: "simulation", cm: 12 };
const at = (h: string) => atHour(d, h);
const banA: EnvAction = { at: at("08:00"), kind: "ban", zones: ["A"] };
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

test("les bans du visiteur ne comptent pas entre 00:00 et 06:00", () => {
  const plan = snowPlan(at("03:00"), [{ at: at("01:00"), kind: "ban", zones: ["A"] }], sim);
  assert.ok(plan.every((p) => p.ban === "en-vigueur" && p.decidedBy === "direction"));
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

test("un ban après 15:00 est ignoré", () => {
  const tooLate: EnvAction = { at: at("15:30"), kind: "ban", zones: ["A"] };
  const plan = snowPlan(at("16:00"), [tooLate], sim);
  assert.ok(plan.every((p) => p.decidedBy === "direction" && p.ban === "programmee"));
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

test("banDeadlinePassed : 15:00", () => {
  assert.equal(banDeadlinePassed(at("14:59")), false);
  assert.equal(banDeadlinePassed(at("15:00")), false);
  assert.equal(banDeadlinePassed(at("15:01")), true);
});

test("banWindow : avant la prévision de 07:30, ouverte de 07:30 à 15:00, trop tard ensuite", () => {
  assert.equal(banWindow(at("02:00")), "avant");
  assert.equal(banWindow(at("07:29")), "avant");
  assert.equal(banWindow(at("07:30")), "ouverte");
  assert.equal(banWindow(at("15:00")), "ouverte");
  assert.equal(banWindow(at("15:01")), "trop-tard");
});

test("une interdiction posée la nuit (R5) ne vaut pas pour le soir ; une réaffectation de nuit, si", () => {
  const night: EnvAction = { at: at("02:00"), kind: "ban", zones: ["A"] };
  const move: EnvAction = { at: at("02:00"), kind: "assign", resource: "CH-01", zone: "B" };
  assert.equal(isDayBan(night), false);
  assert.equal(isDayBan({ at: at("06:30"), kind: "ban", zones: ["A"] }), false);
  assert.equal(isDayBan(banA), true);
  // 08:00 : rien de décidé (la décision de nuit ne compte pas) ; 11:00 : décision par défaut
  assert.ok(snowPlan(at("08:00"), [night], sim).every((p) => p.ban === "aucune"));
  assert.ok(snowPlan(at("11:00"), [night], sim).every((p) => p.decidedBy === "direction" && p.ban === "programmee"));
  assert.ok(zone(at("08:00"), [night, move], "B").resources.includes("CH-01"));
});

// R10 : de 00:00 à 06:00, c'est l'opération de la veille (jour D → nuit du jour D+1)
const next = (h: string) => atHour(atHour(d, "12:00") + 24 * 3_600_000, h);

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
