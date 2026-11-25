import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isNightAt, parseCityPage } from "../src/lib/territoire/meteo";
import { WEATHER_CONDITIONS, weatherCondition, type WeatherCondition } from "../src/lib/territoire/weatherIcon";

const load = (n: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const qc130 = load("eccc-citypage-qc-130");
const snow = load("eccc-citypage-snow");

test("weatherCondition : ciel dégagé, soleil le jour (00) et lune la nuit (30)", () => {
  assert.equal(weatherCondition(0, false), "soleil");
  assert.equal(weatherCondition(30, true), "lune");
  // le code de nuit garde la lune même si l'appelant ne sait pas l'heure
  assert.equal(weatherCondition(30, false), "lune");
  // et le drapeau de nuit l'emporte sur un code de jour publié en retard
  assert.equal(weatherCondition(0, true), "lune");
});

test("weatherCondition : pluie, neige, grêle et orage selon la table d'ECCC", () => {
  assert.equal(weatherCondition(12, false), "pluie");
  assert.equal(weatherCondition(13, true), "pluie");
  assert.equal(weatherCondition(17, false), "neige");
  assert.equal(weatherCondition(16, true), "neige");
  assert.equal(weatherCondition(27, false), "grele");
  assert.equal(weatherCondition(46, false), "grele");
  assert.equal(weatherCondition(19, false), "orage");
  assert.equal(weatherCondition(39, true), "orage");
});

test("weatherCondition : nuages, averses, verglas, brouillard, vent", () => {
  assert.equal(weatherCondition(2, false), "peu-nuageux");
  assert.equal(weatherCondition(32, true), "peu-nuageux");
  assert.equal(weatherCondition(3, false), "nuageux");
  assert.equal(weatherCondition(10, false), "couvert");
  assert.equal(weatherCondition(6, false), "averses");
  assert.equal(weatherCondition(8, false), "averses-neige");
  assert.equal(weatherCondition(38, true), "averses-neige");
  assert.equal(weatherCondition(14, false), "pluie-verglacante");
  assert.equal(weatherCondition(24, false), "brouillard");
  assert.equal(weatherCondition(43, false), "vent");
  assert.equal(weatherCondition(40, false), "neige");
});

test("weatherCondition : code absent, hors table ou « non disponible » (29) → inconnu", () => {
  assert.equal(weatherCondition(null, false), "inconnu");
  assert.equal(weatherCondition(29, false), "inconnu");
  assert.equal(weatherCondition(20, false), "inconnu");
  assert.equal(weatherCondition(49, false), "inconnu");
  assert.equal(weatherCondition(-1, false), "inconnu");
  assert.equal(weatherCondition(2.5, false), "inconnu");
});

test("weatherCondition : chaque code de 0 à 48 donne une condition connue", () => {
  for (let c = 0; c <= 48; c++) {
    const w: WeatherCondition = weatherCondition(c, false);
    assert.ok(WEATHER_CONDITIONS.includes(w), `${c} → ${w}`);
  }
});

test("parseCityPage : iconCode des conditions actuelles, des heures et des périodes", () => {
  const f = parseCityPage(qc130)!;
  assert.equal(f.current.iconCode, 0);
  assert.equal(f.hourly[0].iconCode, 0);
  assert.equal(f.hourly[3].iconCode, 30);
  assert.equal(f.periods[1].iconCode, 30);
  // fiche sans conditions actuelles publiées : code absent
  const s = parseCityPage(snow)!;
  assert.equal(s.current.iconCode, null);
  assert.equal(s.periods[2].iconCode, 17);
});

test("parseCityPage : lever et coucher du soleil ; isNightAt", () => {
  const f = parseCityPage(qc130)!;
  assert.deepEqual(f.sun, { rise: Date.parse("2026-11-25T12:05:00Z"), set: Date.parse("2026-11-25T21:09:00Z") });
  assert.equal(isNightAt(f, Date.parse("2026-11-25T17:00:00Z")), false);
  assert.equal(isNightAt(f, Date.parse("2026-11-25T22:00:00Z")), true);
  assert.equal(isNightAt(f, Date.parse("2026-11-26T05:00:00Z")), true);
  // les jours suivants : mêmes heures, à quelques minutes près
  assert.equal(isNightAt(f, Date.parse("2026-11-26T15:00:00Z")), false);
  // sans lever ni coucher publiés : on ne sait pas, on dit « jour »
  assert.equal(isNightAt({ ...f, sun: null }, Date.parse("2026-11-26T05:00:00Z")), false);
});
