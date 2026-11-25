import assert from "node:assert/strict";
import test from "node:test";
import { decisionView } from "../src/client/territoire/modules/deneigement/labels";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { atHour, type EnvAction } from "../src/lib/territoire/day";

const at = (h: string) => atHour(SCENARIO_DAY, h);
const next = (h: string) => atHour(atHour(SCENARIO_DAY, "12:00") + 24 * 3_600_000, h);
const ban = (h: string, zones: ("A" | "B" | "C")[], t = at(h)): EnvAction => ({ at: t, kind: "ban", zones });

test("08:00 sans décision : rien de coché ; le bouton dit « Aucune interdiction ce soir » et explique l'effet", () => {
  const v = decisionView(at("08:00"), [], null);
  assert.deepEqual(v.checked, []);
  assert.equal(v.dirty, false);
  assert.equal(v.button, "Aucune interdiction ce soir");
  assert.match(v.empty ?? "", /pas d'interdiction ce soir/);
  assert.equal(v.caution, null);
  assert.equal(v.status, "Aucune décision pour ce soir");
  // une zone cochée : « Décider pour ce soir », choix non enregistré signalé
  const w = decisionView(at("08:00"), [], { base: v.base, zones: ["A"] });
  assert.deepEqual(w.checked, ["A"]);
  assert.equal(w.dirty, true);
  assert.equal(w.button, "Décider pour ce soir");
  assert.equal(w.empty, null);
});

test("après 10:00 : les cases suivent la décision par défaut ; un choix commencé avant est oublié, pas affiché à côté", () => {
  const before = decisionView(at("09:00"), [], null);
  const v = decisionView(at("10:30"), [], { base: before.base, zones: ["A"] });
  assert.deepEqual(v.checked, ["A", "B", "C"]);
  assert.equal(v.dirty, false);
  assert.equal(v.status, "Décidée à 10 h 00 par la direction (simulé)");
  // décocher C sur cette décision : non enregistré
  const w = decisionView(at("10:30"), [], { base: v.base, zones: ["A", "B"] });
  assert.equal(w.dirty, true);
  assert.deepEqual(w.checked, ["A", "B"]);
});

test("après la décision du visiteur : cases = décision, rien de non enregistré", () => {
  const v = decisionView(at("08:05"), [ban("08:00", ["A", "B"])], null);
  assert.deepEqual(v.checked, ["A", "B"]);
  assert.equal(v.dirty, false);
  assert.equal(v.status, "Décidée par vous à 8 h 00");
});

test("R11 : après 15:00, le bouton reste « Décider pour ce soir », jamais « Trop tard » ; mise en garde seulement pendant une décision", () => {
  // décision par défaut en vigueur, rien de changé : rien n'est en train de se décider, pas de mise en garde
  const v = decisionView(at("16:00"), [], null);
  assert.equal(v.button, "Décider pour ce soir");
  assert.equal(v.dirty, false);
  assert.equal(v.caution, null);
  assert.equal(v.status, "Décidée à 10 h 00 par la direction (simulé)");
  assert.doesNotMatch(JSON.stringify(v), /trop tard/i);
  // un choix non enregistré : la décision tardive se prend, la mise en garde s'affiche (sans bloquer)
  const w = decisionView(at("16:00"), [], { base: v.base, zones: ["B"] });
  assert.equal(w.dirty, true);
  assert.equal(w.button, "Décider pour ce soir");
  assert.equal(w.caution, "Décision tardive : les résidents auront moins de temps pour déplacer leur véhicule.");
  assert.doesNotMatch(JSON.stringify(w), /trop tard/i);
  // une fois décidée (16:00), plus de mise en garde à côté de « Décidée par vous à 16 h 00 »
  const after = decisionView(at("16:05"), [ban("16:00", ["B"])], null);
  assert.equal(after.status, "Décidée par vous à 16 h 00");
  assert.equal(after.caution, null);
  // la décision de la direction remplacée par « aucune zone » le matin, puis rien coché l'après-midi : pas de choix en cours
  assert.equal(decisionView(at("16:00"), [ban("09:00", [])], null).caution, null);
});

test("R11 : la nuit, le bouton change la nuit en cours ; « En vigueur jusqu'à 6 h »", () => {
  const v = decisionView(next("00:30"), [ban("08:00", ["A", "B"])], null);
  assert.deepEqual(v.checked, ["A", "B"]);
  assert.equal(v.status, "Décidée par vous à 8 h 00");
  assert.equal(v.caution, "En vigueur jusqu'à 6 h. De nuit, une décision change les feux tout de suite.");
  assert.equal(v.button, "Appliquer à la nuit en cours");
  const off = decisionView(next("00:30"), [ban("08:00", ["A", "B"])], { base: v.base, zones: [] });
  assert.equal(off.button, "Lever l'interdiction cette nuit");
  assert.match(off.empty ?? "", /s'éteignent tout de suite/);
});

test("la nuit, une décision « aucune zone » de la veille est nommée (pas « Aucune décision »)", () => {
  const v = decisionView(next("00:30"), [ban("11:00", [])], null);
  assert.equal(v.status, "Décidée par vous à 11 h 00 : aucune zone");
  assert.deepEqual(v.checked, []);
  // rien en vigueur : pas de « jusqu'à 6 h »
  assert.equal(v.caution, "De nuit, une décision change les feux tout de suite.");
});
