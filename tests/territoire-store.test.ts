import assert from "node:assert/strict";
import { test } from "node:test";
import { scenarioSteps } from "../src/lib/aqueduc/scenario";
import { actionsUpTo, atHour, dayStartOf } from "../src/lib/territoire/day";
import { aqueducStore, currentIncident, isolatedAt } from "../src/client/aqueduc/store";
import { closeValves, exploreFreely, startScenario } from "../src/client/aqueduc/scenarioController";
import { attachScenario, syncIncident } from "../src/client/aqueduc/scenarioSync";
import { act, backToNow, FORECAST_RETRY_MS, FORECAST_TTL_MS, forecastOf, loadForecast, offerForecast, seek, setFocus, setSpeed, simNow, territoireStore, undoLast } from "../src/client/territoire/store";
import type { Forecast } from "../src/lib/territoire/meteo";

/** 3 décembre 2026, minuit heure de l'Est : une autre journée que celle des tests de l'aqueduc. */
const DAY = Date.UTC(2026, 11, 3, 5, 0);
const NOW = Date.UTC(2026, 11, 3, 18, 0);
const VALVES = [3, 7];

const reset = () => territoireStore.setState({ clock: { t0: atHour(DAY, "09:00"), speed: 1, startedAt: NOW }, actions: [], focus: null });

test("au départ : « maintenant », mode classique, aucune action ni sélection d'environnement", () => {
  const s = territoireStore.getState();
  assert.equal(s.clock.speed, 1);
  assert.ok(Math.abs(simNow() - Date.now()) < 5_000);
  assert.equal(s.mode, "classic");
  assert.equal(s.api, "absente");
  assert.equal(s.fallback, "");
  assert.deepEqual(s.actions, []);
  assert.equal(s.env, null);
  assert.equal(s.forecast, "chargement");
  assert.equal(s.focus, null);
});

test("horloge commune : ×60, saut sans à-coup, retour à maintenant", () => {
  reset();
  setSpeed(60, NOW + 1_000);
  assert.equal(simNow(NOW + 1_000), atHour(DAY, "09:00") + 1_000);
  assert.equal(simNow(NOW + 2_000), atHour(DAY, "09:00") + 61_000);
  seek(atHour(DAY, "14:00"), NOW + 3_000);
  assert.equal(simNow(NOW + 3_000), atHour(DAY, "14:00"));
  assert.equal(territoireStore.getState().clock.speed, 60);
  backToNow(NOW + 4_000);
  assert.deepEqual(territoireStore.getState().clock, { t0: NOW + 4_000, speed: 1, startedAt: NOW + 4_000 });
});

test("act : horodatée à l'heure simulée, liste toujours triée par heure (insertion stable)", () => {
  reset();
  const a = act({ kind: "ban", zones: ["A"] }, NOW + 60_000);
  assert.equal(a.at, atHour(DAY, "09:01"));
  assert.deepEqual(territoireStore.getState().actions, [{ at: atHour(DAY, "09:01"), kind: "ban", zones: ["A"] }]);
  // retour en arrière : la décision prise plus tôt se range avant
  seek(atHour(DAY, "08:00"), NOW + 60_000);
  act({ kind: "assign", resource: "N-01", zone: "B" }, NOW + 60_000);
  // même heure : après celle déjà posée
  act({ kind: "assign", resource: "N-02", zone: "C" }, NOW + 60_000);
  seek(atHour(DAY, "09:01"), NOW + 60_000);
  act({ kind: "ban", zones: ["A", "B"] }, NOW + 60_000);
  const got = territoireStore.getState().actions;
  assert.deepEqual(
    got.map((x) => x.kind === "assign" ? x.resource : x.kind === "ban" ? x.zones.join("") : x.kind),
    ["N-01", "N-02", "A", "AB"],
  );
  for (let i = 1; i < got.length; i++) assert.ok(got[i].at >= got[i - 1].at);
});

test("seek avant une action : actionsUpTo ne la compte plus, puis la retrouve", () => {
  reset();
  seek(atHour(DAY, "10:00"), NOW);
  act({ kind: "ban", zones: ["A"] }, NOW);
  assert.equal(actionsUpTo(territoireStore.getState().actions, simNow(NOW)).length, 1);
  seek(atHour(DAY, "09:30"), NOW);
  assert.deepEqual(actionsUpTo(territoireStore.getState().actions, simNow(NOW)), []);
  seek(atHour(DAY, "10:30"), NOW);
  assert.equal(actionsUpTo(territoireStore.getState().actions, simNow(NOW)).length, 1);
});

test("undoLast : retire la dernière action du genre déjà posée à l'heure simulée", () => {
  reset();
  seek(atHour(DAY, "10:00"), NOW);
  act({ kind: "ban", zones: ["A"] }, NOW);
  seek(atHour(DAY, "11:00"), NOW);
  act({ kind: "ban", zones: ["B"] }, NOW);
  act({ kind: "assign", resource: "N-01", zone: "A" }, NOW);
  // à 10:30, la décision de 11:00 n'est pas encore prise : c'est celle de 10:00 qui part
  seek(atHour(DAY, "10:30"), NOW);
  assert.deepEqual(undoLast("ban", NOW), { at: atHour(DAY, "10:00"), kind: "ban", zones: ["A"] });
  assert.deepEqual(territoireStore.getState().actions.map((a) => a.kind), ["ban", "assign"]);
  assert.equal(undoLast("ban", NOW), null);
  assert.equal(territoireStore.getState().actions.length, 2);
});

test("setFocus : élément mis en avant (cloche d'alertes), puis effacé", () => {
  setFocus({ env: "aqueduc", kind: "incident", id: "13C1949" });
  assert.deepEqual(territoireStore.getState().focus, { env: "aqueduc", kind: "incident", id: "13C1949" });
  setFocus(null);
  assert.equal(territoireStore.getState().focus, null);
});

test("currentIncident : vannes fermées à 14:30 après une isolation à 14:25, pas avant", () => {
  const actions = [{ at: atHour(DAY, "14:25"), kind: "isolate" as const }];
  assert.equal(isolatedAt(actions, atHour(DAY, "14:24")), null);
  assert.equal(isolatedAt(actions, atHour(DAY, "14:30")), atHour(DAY, "14:25"));
  assert.equal(currentIncident(atHour(DAY, "13:59"), actions, VALVES), null);
  assert.deepEqual(currentIncident(atHour(DAY, "14:24"), actions, VALVES)!.closedValves, []);
  const inc = currentIncident(atHour(DAY, "14:30"), actions, VALVES)!;
  assert.deepEqual(inc.closedValves, VALVES);
  assert.equal(inc.startedAt, atHour(DAY, "14:00"));
  // l'isolation de la veille ne compte pas
  const next = DAY + 24 * 3_600_000;
  assert.deepEqual(currentIncident(atHour(next, "14:30"), actions, VALVES)!.closedValves, []);
});

test("incident de l'aqueduc dérivé de l'horloge commune et des actions, à chaque changement", (t) => {
  // l'heure réelle (Date.now) est celle des tests : une décision est datée à l'heure simulée courante
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  reset();
  const detach = attachScenario({ valves: VALVES });
  assert.equal(aqueducStore.getState().incident, null);
  seek(atHour(DAY, "14:20"));
  assert.deepEqual(aqueducStore.getState().incident, currentIncident(atHour(DAY, "14:20"), [], VALVES));
  act({ kind: "isolate" });
  assert.deepEqual(aqueducStore.getState().incident!.closedValves, VALVES);
  seek(atHour(DAY, "14:10"));
  assert.deepEqual(aqueducStore.getState().incident!.closedValves, []);
  seek(atHour(DAY, "12:00"));
  assert.equal(aqueducStore.getState().incident, null);
  // le temps passe : l'appelant rappelle syncIncident (une fois par seconde dans l'application)
  setSpeed(60);
  t.mock.timers.setTime(NOW + 130_000);
  syncIncident();
  assert.equal(aqueducStore.getState().incident!.startedAt, atHour(DAY, "14:00"));
  detach();
});

test("scénario guidé sur la journée simulée : détection à 14:01, isolation enregistrée, retour à l'heure et à la vitesse quittées", async () => {
  reset();
  setSpeed(60, NOW);
  const left = simNow(NOW + 1_000);
  const detach = attachScenario({ valves: VALVES });
  startScenario(NOW + 1_000);
  const steps = scenarioSteps(DAY);
  let clock = territoireStore.getState().clock;
  assert.deepEqual(clock, { t0: steps[0].at, speed: 1, startedAt: NOW + 1_000 });
  assert.equal(dayStartOf(clock.t0), DAY);
  // l'isolation n'est enregistrée qu'une fois la fermeture confirmée par le serveur
  aqueducStore.setState({ scenario: { ...aqueducStore.getState().scenario, step: "isolation" } });
  seek(steps[1].at, NOW + 2_000);
  const ok = async () => ({ ok: true as const, isolation: { segment: 0, valves: VALVES, isolated: [] } });
  assert.deepEqual(await closeValves(async () => ({ ok: false as const, reason: "refusé" }), NOW + 3_000), { ok: false, reason: "refusé" });
  assert.deepEqual(territoireStore.getState().actions, []);
  assert.deepEqual(await closeValves(ok, NOW + 3_000), { ok: true });
  assert.deepEqual(territoireStore.getState().actions, [{ at: steps[1].at + 1_000, kind: "isolate" }]);
  assert.deepEqual(aqueducStore.getState().incident!.closedValves, VALVES);
  exploreFreely(NOW + 5_000);
  clock = territoireStore.getState().clock;
  assert.deepEqual(clock, { t0: left, speed: 60, startedAt: NOW + 5_000 });
  // la décision du visiteur reste dans la ville
  assert.equal(territoireStore.getState().actions.length, 1);
  detach();
});

const fc = (issuedAt: string): Forecast => ({ source: "eccc", issuedAt, current: { tempC: -3, condition: "Neige" }, periods: [], hourly: [], warnings: [] });

/** `fetch` simulé : réponses données dans l'ordre (statut 500 → `null`), appels comptés. */
function stubFetch(replies: (Forecast | null | "500")[]) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const r = replies.shift();
    if (r === "500" || r === undefined) return new Response("erreur", { status: 500 });
    return Response.json({ forecast: r });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = real) };
}

test("loadForecast : 500 → null, nouvel essai après 30 s seulement ; la reprise de l'API corrige", async () => {
  territoireStore.setState({ forecast: "chargement", forecastAt: 0 });
  const f = stubFetch(["500", fc("2026-12-03T12:00:00Z")]);
  try {
    const T = 1_000_000_000_000;
    await loadForecast({ now: T });
    assert.equal(territoireStore.getState().forecast, null);
    assert.equal(f.calls.length, 1);
    await loadForecast({ now: T + FORECAST_RETRY_MS - 1 });
    assert.equal(f.calls.length, 1, "pas de nouvel essai avant 30 s");
    await loadForecast({ now: T + FORECAST_RETRY_MS });
    assert.equal(f.calls.length, 2);
    assert.equal(forecastOf(territoireStore.getState())?.issuedAt, "2026-12-03T12:00:00Z");
  } finally {
    f.restore();
  }
});

test("loadForecast : fraîche, rien ; plus de 10 min, rafraîchie ; un échec garde la prévision réelle ; « Réessayer » force", async () => {
  const T = 1_100_000_000_000;
  territoireStore.setState({ forecast: fc("2026-12-03T12:00:00Z"), forecastAt: T });
  const f = stubFetch(["500", fc("2026-12-03T13:00:00Z"), fc("2026-12-03T14:00:00Z")]);
  try {
    await loadForecast({ now: T + FORECAST_TTL_MS - 1 });
    assert.equal(f.calls.length, 0);
    await loadForecast({ now: T + FORECAST_TTL_MS });
    assert.equal(f.calls.length, 1);
    assert.equal(forecastOf(territoireStore.getState())?.issuedAt, "2026-12-03T12:00:00Z", "l'échec ne remplace pas la prévision réelle");
    await loadForecast({ now: T + FORECAST_TTL_MS + FORECAST_RETRY_MS });
    assert.equal(forecastOf(territoireStore.getState())?.issuedAt, "2026-12-03T13:00:00Z");
    assert.equal(territoireStore.getState().forecastAt, T + FORECAST_TTL_MS + FORECAST_RETRY_MS);
    // « Réessayer » : sans attendre
    await loadForecast({ force: true, now: T + FORECAST_TTL_MS + FORECAST_RETRY_MS + 1 });
    assert.equal(f.calls.length, 3);
    assert.equal(forecastOf(territoireStore.getState())?.issuedAt, "2026-12-03T14:00:00Z");
  } finally {
    f.restore();
  }
});

test("loadForecast : une seule requête à la fois", async () => {
  territoireStore.setState({ forecast: "chargement", forecastAt: 0 });
  const f = stubFetch([fc("2026-12-03T12:00:00Z")]);
  try {
    const a = loadForecast({ now: 1 });
    const b = loadForecast({ force: true, now: 2 });
    assert.equal(a, b);
    await a;
    assert.equal(f.calls.length, 1);
  } finally {
    f.restore();
  }
});

test("offerForecast (accueil) : la prévision du serveur remplace une plus ancienne, jamais une réelle par un échec", () => {
  territoireStore.setState({ forecast: "chargement", forecastAt: 0 });
  offerForecast(null, 5);
  assert.equal(territoireStore.getState().forecast, null);
  offerForecast(fc("2026-12-03T12:00:00Z"), 6);
  assert.equal(forecastOf(territoireStore.getState())?.issuedAt, "2026-12-03T12:00:00Z");
  offerForecast(fc("2026-12-03T13:00:00Z"), 7);
  assert.equal(forecastOf(territoireStore.getState())?.issuedAt, "2026-12-03T13:00:00Z");
  assert.equal(territoireStore.getState().forecastAt, 7);
  // plus ancienne ou indisponible : la prévision du store reste
  offerForecast(fc("2026-12-03T11:00:00Z"), 8);
  offerForecast(null, 9);
  assert.equal(forecastOf(territoireStore.getState())?.issuedAt, "2026-12-03T13:00:00Z");
  assert.equal(territoireStore.getState().forecastAt, 7);
});
