import assert from "node:assert/strict";
import test from "node:test";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { allAlerts, aqueducAlerts, deneigementAlerts, deneigementAlertsWith, sortAlerts, summarize, type Alert } from "../src/lib/territoire/alerts";
import { atHour, type EnvAction } from "../src/lib/territoire/day";
import { deneigementStatus } from "../src/lib/territoire/home";
import type { SnowSource } from "../src/lib/territoire/neige";

const d = SCENARIO_DAY;
const at = (h: string) => atHour(d, h);
const sim: SnowSource = { kind: "simulation", cm: 12 };
const eccc: SnowSource = { kind: "eccc", cm: 6, label: "prévision Environnement Canada" };

test("déneigement : une alerte attention à 08:00 sans décision", () => {
  const a = deneigementAlerts(at("08:00"), [], sim);
  assert.equal(a.length, 1);
  assert.equal(a[0].severity, "attention");
  assert.equal(a[0].env, "deneigement");
  assert.equal(a[0].title, "Neige prévue ce soir — décider l'interdiction de stationner");
  assert.match(a[0].detail, /12 cm/);
  assert.match(a[0].detail, /Simulation/);
  assert.match(a[0].detail, /36 h/);
});

test("déneigement : le détail nomme la source eccc", () => {
  assert.match(deneigementAlerts(at("08:00"), [], eccc)[0].detail, /6 cm.*prévision Environnement Canada/);
});

test("déneigement : rien avant 07:30, rien à 12:30 grâce à la décision par défaut", () => {
  assert.deepEqual(deneigementAlerts(at("07:00"), [], sim), []);
  assert.deepEqual(deneigementAlerts(at("12:30"), [], sim), []);
});

test("déneigement : rien après une décision du visiteur", () => {
  const ban: EnvAction = { at: at("08:00"), kind: "ban", zones: ["A"] };
  assert.deepEqual(deneigementAlerts(at("09:00"), [ban], sim), []);
});

test("déneigement sans décision par défaut : critique dès 12:00, trop tard dès 15:00", () => {
  const noDefault = (h: string) => deneigementAlertsWith(at(h), [], sim, false);
  assert.equal(noDefault("11:59")[0].severity, "attention");
  assert.equal(noDefault("12:00")[0].severity, "critique");
  const late = noDefault("15:00");
  assert.equal(late.length, 1);
  assert.equal(late[0].title, "Trop tard pour ce soir");
  assert.equal(late[0].severity, "critique");
  assert.deepEqual(deneigementAlertsWith(at("14:00"), [{ at: at("13:00"), kind: "ban", zones: ["B"] }], sim, false), []);
});

test("déneigement : interdiction en vigueur dans 3 zones la nuit", () => {
  for (const h of ["23:00", "23:30"]) {
    const a = deneigementAlerts(at(h), [], sim);
    assert.equal(a.length, 1);
    assert.equal(a[0].severity, "info");
    assert.equal(a[0].title, "Interdiction en vigueur dans 3 zones");
  }
  const night = deneigementAlerts(at("02:00"), [], sim);
  assert.equal(night[0].title, "Interdiction en vigueur dans 3 zones");
  assert.deepEqual(deneigementAlerts(at("06:00"), [], sim), []);
  const one = deneigementAlerts(at("23:30"), [{ at: at("08:00"), kind: "ban", zones: ["A"] }], sim);
  assert.equal(one[0].title, "Interdiction en vigueur dans 1 zone");
});

test("aqueduc : critique à 14:05, attention à 15:10, rien à 21:00 ni avant 14:01", () => {
  assert.deepEqual(aqueducAlerts(at("14:00"), []), []);
  const c = aqueducAlerts(at("14:05"), []);
  assert.equal(c.length, 1);
  assert.equal(c[0].severity, "critique");
  assert.equal(c[0].title, "Bris de conduite 13C1949 · Centre-ville");
  assert.deepEqual(c[0].focus, { env: "aqueduc", kind: "incident", id: "13C1949" });
  const a = aqueducAlerts(at("15:10"), []);
  assert.equal(a.length, 1);
  assert.equal(a[0].severity, "attention");
  assert.equal(a[0].title, "Réparation en cours");
  assert.deepEqual(aqueducAlerts(at("21:00"), []), []);
});

test("aqueduc : l'isolation du visiteur fait passer à « réparation en cours »", () => {
  const iso: EnvAction = { at: at("14:30"), kind: "isolate" };
  assert.equal(aqueducAlerts(at("14:29"), [iso])[0].severity, "critique");
  assert.equal(aqueducAlerts(at("14:31"), [iso])[0].severity, "attention");
  // retour en arrière avant l'action : critique de nouveau
  assert.equal(aqueducAlerts(at("14:20"), [iso])[0].severity, "critique");
});

test("allAlerts : ne garde que les alertes actives", () => {
  assert.deepEqual(allAlerts(at("14:05"), [], sim).map((x) => x.id), ["aqueduc-bris"]);
  assert.deepEqual(allAlerts(at("08:00"), [], sim).map((x) => x.id), ["neige-decision"]);
  assert.deepEqual(allAlerts(at("23:30"), [], sim).map((x) => x.id), ["neige-vigueur"]);
});

test("sortAlerts : critique, attention, info, puis le plus récent", () => {
  const mk = (id: string, severity: Alert["severity"], t: number): Alert => ({ id, env: "aqueduc", severity, title: "", detail: "", at: t });
  const sorted = sortAlerts([mk("i", "info", 9), mk("a1", "attention", 1), mk("c", "critique", 0), mk("a2", "attention", 5)]);
  assert.deepEqual(sorted.map((x) => x.id), ["c", "a2", "a1", "i"]);
});

test("summarize compte par gravité", () => {
  const mk = (severity: Alert["severity"]): Alert => ({ id: severity, env: "aqueduc", severity, title: "", detail: "", at: 0 });
  assert.deepEqual(summarize([mk("critique"), mk("info"), mk("info"), mk("attention")]), { critique: 1, attention: 1, info: 2 });
  assert.deepEqual(summarize([]), { critique: 0, attention: 0, info: 0 });
});

test("déneigement : une interdiction posée la nuit ne retire pas l'alerte de décision du matin (R5)", () => {
  const night: EnvAction = { at: at("02:00"), kind: "ban", zones: ["A"] };
  assert.equal(deneigementAlerts(at("08:00"), [night], sim)[0]?.id, "neige-decision");
});

test("R10 : la nuit suivant un ban A+B, l'alerte « en vigueur » compte 2 zones ; l'accueil aussi", () => {
  const ban: EnvAction = { at: at("08:00"), kind: "ban", zones: ["A", "B"] };
  const t = atHour(at("12:00") + 24 * 3_600_000, "00:30");
  const a = deneigementAlerts(t, [ban], sim);
  assert.equal(a.length, 1);
  assert.equal(a[0].title, "Interdiction en vigueur dans 2 zones");
  assert.match(deneigementStatus(t, [ban], sim).text, /^Interdiction en vigueur · 2 zones/);
  assert.match(deneigementStatus(t, [], sim).text, /^Interdiction en vigueur · 3 zones/);
});
