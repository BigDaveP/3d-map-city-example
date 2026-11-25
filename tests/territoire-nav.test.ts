import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { originTrialMeta } from "../src/lib/origin-trial";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { aqueducAlerts, deneigementAlerts } from "../src/lib/territoire/alerts";
import { ATTRIBUTIONS, DEMO_CONSTANTS, NON_OFFICIAL, REALITY, SOURCES } from "../src/lib/territoire/about";
import { atHour, DAY_TIMES, type EnvAction } from "../src/lib/territoire/day";
import { ENVS } from "../src/lib/territoire/envs";
import { alertFocus, aqueducStatus, deneigementStatus, envHref, homeEnvs, homeSnapshot, hourLabel, overviewStamp } from "../src/lib/territoire/home";
import { METEO_ATTRIBUTION, parseCityPage } from "../src/lib/territoire/meteo";
import type { SnowSource } from "../src/lib/territoire/neige";

const env = (o: Record<string, string> = {}) => ({ NODE_ENV: "test", ...o }) as NodeJS.ProcessEnv;
const at = (h: string) => atHour(SCENARIO_DAY, h);
const sim: SnowSource = { kind: "simulation", cm: 12 };

test("originTrialMeta : null sans jeton ou avec jeton vide", () => {
  assert.equal(originTrialMeta(env()), null);
  assert.equal(originTrialMeta(env({ HIC_ORIGIN_TRIAL_TOKEN: "  " })), null);
});

test("originTrialMeta : renvoie la méta avec le jeton", () => {
  assert.deepEqual(originTrialMeta(env({ HIC_ORIGIN_TRIAL_TOKEN: "abc" })), { httpEquiv: "origin-trial", content: "abc" });
});

test("accueil : les 5 environnements de ENVS, dans l'ordre ; seuls Aqueduc et Déneigement ont un lien", () => {
  const list = homeEnvs(at("12:00"), [], sim);
  assert.deepEqual(list.map((e) => e.id), Object.keys(ENVS));
  assert.deepEqual(list.map((e) => e.id), ["aqueduc", "deneigement", "collecte", "zonage", "evaluation"]);
  assert.deepEqual(list.map((e) => e.href), ["/carte/aqueduc", "/carte/deneigement", null, null, null]);
  for (const e of list.slice(2)) assert.deepEqual(e.status, { tone: "off", text: "À venir" });
});

test("accueil : ?mode de l'accueil transmis aux liens des environnements et des alertes", () => {
  assert.deepEqual(homeEnvs(at("12:00"), [], sim, "classic").map((e) => e.href), ["/carte/aqueduc?mode=classic", "/carte/deneigement?mode=classic", null, null, null]);
  assert.equal(envHref("deneigement", "hic"), "/carte/deneigement?mode=hic");
  const snap = homeSnapshot(at("14:05"), [], null, "hic");
  assert.ok(snap.alerts.length > 0);
  for (const a of snap.alerts) assert.equal(a.href, `/carte/${a.env}?mode=hic`);
});

test("heures et date en français, à l'heure de Trois-Rivières", () => {
  assert.equal(hourLabel(at("14:05")), "14 h 05");
  assert.equal(hourLabel(at("07:30")), "7 h 30");
  assert.equal(overviewStamp(at("14:05")), "mardi 24 nov., 14 h 05");
  assert.equal(overviewStamp(at("23:59")), "mardi 24 nov., 23 h 59");
});

test("état de l'aqueduc : rien avant 14 h, bris non isolé, isolé par le visiteur ou l'équipe, réparé", () => {
  assert.equal(aqueducStatus(at("12:00"), []).tone, "ok");
  assert.match(aqueducStatus(at("12:00"), []).text, /Aucun bris/);
  assert.deepEqual(aqueducStatus(at("14:05"), []), { tone: "critique", text: "1 bris non isolé · Centre-ville (simulé)" });
  const iso: EnvAction = { at: at("14:10"), kind: "isolate" };
  assert.equal(aqueducStatus(at("14:20"), [iso]).tone, "attention");
  // reculer avant l'isolation la fait disparaître
  assert.equal(aqueducStatus(at("14:05"), [iso]).tone, "critique");
  // sans le visiteur, l'équipe isole à l'intervention (15:08)
  assert.equal(aqueducStatus(at("15:10"), []).tone, "attention");
  assert.deepEqual(aqueducStatus(at("19:00"), []), { tone: "ok", text: "Bris réparé, eau rétablie à 18 h 43 (simulé)" });
});

test("état du déneigement : nuit en vigueur, prévision, décision, interdiction programmée puis en vigueur", () => {
  assert.match(deneigementStatus(at("03:00"), [], sim).text, /^Interdiction en vigueur · 3 zones · déneigement à \d+ % \(simulé\)$/);
  assert.equal(deneigementStatus(at("06:30"), [], sim).text, "Aucune interdiction · prévision à 7 h 30 (simulé)");
  assert.deepEqual(deneigementStatus(at("08:00"), [], sim), { tone: "attention", text: "Neige prévue · décision conseillée avant 15 h 00 (simulé)" });
  assert.equal(deneigementStatus(at("10:30"), [], sim).text, "Interdiction ce soir dès 23 h · 3 zones (direction, simulé)");
  const ban: EnvAction = { at: at("08:30"), kind: "ban", zones: ["A", "B"] };
  assert.equal(deneigementStatus(at("09:00"), [ban], sim).text, "Interdiction ce soir dès 23 h · 2 zones (votre décision)");
  assert.equal(deneigementStatus(at("23:30"), [ban], sim).tone, "info");
  assert.match(deneigementStatus(at("23:30"), [ban], sim).text, /^Interdiction en vigueur · 2 zones/);
  // décision du visiteur sans aucune zone
  assert.equal(deneigementStatus(at("16:00"), [{ at: at("09:00"), kind: "ban", zones: [] }], sim).text, "Aucune interdiction ce soir (simulé)");
});

test("instantané de l'accueil à 14:05 sans action : bris critique en tête, résumé, trois prochains événements", () => {
  const snap = homeSnapshot(at("14:05"), [], null);
  assert.equal(snap.stamp, "mardi 24 nov., 14 h 05");
  assert.equal(snap.alerts[0].id, "aqueduc-bris");
  assert.equal(snap.alerts[0].severity, "critique");
  assert.equal(snap.alerts[0].time, "14 h 01");
  assert.deepEqual(snap.summary, { critique: 1, attention: 0, info: 0 });
  assert.deepEqual(snap.next.map((e) => [e.time, e.label]), [
    ["15 h 00", "Heure conseillée pour décider l'interdiction"],
    ["19 h 00", "Début de la neige"],
    ["23 h 00", "Interdiction en vigueur"],
  ]);
  assert.deepEqual(snap.snow, sim);
  // le soir, les événements de demain sont marqués
  const late = homeSnapshot(at("23:30"), [], null).next;
  assert.ok(late.every((e) => e.tomorrow));
  assert.equal(late[0].time, "6 h 00");
});

test("ouvrir une alerte : le focus n'est posé que pour l'environnement de l'alerte", () => {
  const bris = aqueducAlerts(at("14:05"), [])[0];
  assert.deepEqual(alertFocus(bris), { env: "aqueduc", kind: "incident", id: "13C1949" });
  const neige = deneigementAlerts(at("08:00"), [], sim)[0];
  assert.equal(alertFocus(neige), null);
  assert.equal(alertFocus({ ...bris, env: "deneigement" }), null);
});

/** Rendu statique d'un composant dans un processus sans la condition react-server (react-dom/server y est refusé). */
function renderWeather(forecastJson: string, now = Date.parse("2026-11-25T17:30:00Z")): string {
  const code = `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { WeatherSummary } from "./src/client/territoire/home/Weather.tsx";
    process.stdout.write(renderToStaticMarkup(createElement(WeatherSummary, { forecast: ${forecastJson}, now: ${now} })));
  `;
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8" });
}

test("météo de l'accueil : prévision nulle → « Météo indisponible », neige simulée, attribution", () => {
  const html = renderWeather("null");
  assert.match(html, /Météo indisponible/);
  assert.match(html, /Simulation/);
  assert.ok(html.includes(METEO_ATTRIBUTION.replace(/'/g, "&#x27;")), html);
});

test("météo de l'accueil : conditions actuelles, ce soir et neige des prochaines 36 h", () => {
  const f = parseCityPage(JSON.parse(readFileSync("tests/fixtures/eccc-citypage-qc-130.json", "utf8")));
  const html = renderWeather(JSON.stringify(f));
  assert.doesNotMatch(html, /Météo indisponible/);
  assert.match(html, /Ensoleillé/);
  assert.match(html, /Ce soir et cette nuit/);
  assert.match(html, /prochaines 36 h/);
  // avertissement d'ECCC en casse de phrase
  assert.match(html, /Bulletin météorologique spécial/);
});

test("météo de l'accueil : icône de 48 px des conditions actuelles, icônes de 16 px des prochaines heures", () => {
  const f = parseCityPage(JSON.parse(readFileSync("tests/fixtures/eccc-citypage-qc-130.json", "utf8")));
  // 12 h 30 à Trois-Rivières : soleil (code 00), puis la nuit tombe (lune, code 30, coucher à 16 h 09)
  const html = renderWeather(JSON.stringify(f));
  assert.match(html, /<svg class="tr-wx-i" data-condition="soleil" width="48" height="48"/);
  const hours = [...html.matchAll(/<li><span class="tr-weather-h">([^<]+)<\/span><svg class="tr-wx-i" data-condition="([a-z-]+)" width="16"[^>]*aria-label="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
  assert.deepEqual(hours, ["13 h soleil Ensoleillé", "15 h soleil Ensoleillé", "17 h lune Dégagé", "19 h lune Dégagé", "21 h lune Dégagé", "23 h lune Dégagé"]);
  // le soir : lune pour les conditions actuelles, même si la fiche dit encore « Ensoleillé » (00)
  const evening = renderWeather(JSON.stringify(f), Date.parse("2026-11-25T22:30:00Z"));
  assert.match(evening, /data-condition="lune" width="48"/);
});

test("À propos : phrase « non officielle » mot pour mot, quatre attributions, sources avec licence et lien", () => {
  assert.equal(NON_OFFICIAL, "Démo non officielle. Ni la Ville de Trois-Rivières ni aucune autre municipalité n'a produit, vérifié ou approuvé cette démo.");
  assert.deepEqual([...ATTRIBUTIONS], [
    "Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4.0",
    "Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0",
    "Météo : Environnement et Changement climatique Canada (Licence du gouvernement ouvert – Canada)",
    "Fond de carte : OpenFreeMap / OpenMapTiles / OpenStreetMap",
  ]);
  assert.equal(SOURCES.length, 4);
  for (const s of SOURCES) assert.ok(s.publisher && s.licence && s.href.startsWith("https://") && s.licenceHref.startsWith("https://"), s.dataset);
  assert.deepEqual(Object.keys(REALITY), Object.keys(ENVS));
  for (const t of [DAY_TIMES.defaultDecisionAt, DAY_TIMES.decisionDeadline, DAY_TIMES.banStart]) assert.ok(DEMO_CONSTANTS.some((c) => c.value === t), t);
});
