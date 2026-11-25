import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCityPage, snowTonightCm, snowWarning, SNOW_THRESHOLD_CM, warningTitle, type Forecast } from "../src/lib/territoire/meteo";
import { createForecastSource, FAIL_TTL_MS, getForecast } from "../src/server/territoire/meteo";

const load = (n: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const qc130 = load("eccc-citypage-qc-130");
const snow = load("eccc-citypage-snow");
const okFetch = (async () => new Response(JSON.stringify(qc130))) as unknown as typeof fetch;

test("parseCityPage : Trois-Rivières", () => {
  const f = parseCityPage(qc130)!;
  assert.equal(f.source, "eccc");
  assert.ok(f.current.condition.length > 0);
  assert.ok(f.periods.length >= 2);
  assert.ok(f.hourly.length >= 12);
  assert.equal(f.warnings[0].title, "BULLETIN MÉTÉOROLOGIQUE SPÉCIAL");
  assert.equal(typeof f.hourly[0].t, "number");
});

test("snowTonightCm : 0 sans neige, 1 cm dans la fixture de neige", () => {
  assert.equal(snowTonightCm(parseCityPage(qc130)!), 0);
  assert.equal(snowTonightCm(parseCityPage(snow)!), 1);
});

test("warningTitle : titre en capitales d'ECCC en casse de phrase, autre titre tel quel", () => {
  assert.equal(warningTitle("AVERTISSEMENT DE NEIGE"), "Avertissement de neige");
  assert.equal(warningTitle("BULLETIN MÉTÉOROLOGIQUE SPÉCIAL"), "Bulletin météorologique spécial");
  assert.equal(warningTitle("Avis de neige"), "Avis de neige");
});

test("parseCityPage : format inattendu → null", () => {
  assert.equal(parseCityPage({}), null);
  assert.equal(parseCityPage(null), null);
});

test("snowWarning : titre contenant NEIGE ou HIVER", () => {
  const f = parseCityPage(qc130)!;
  assert.equal(snowWarning(f), null);
  const w: Forecast = { ...f, warnings: [{ title: "AVERTISSEMENT DE TEMPÊTE HIVERNALE", type: "warning", expires: "" }, { title: "AVIS DE NEIGE", type: "watch", expires: "" }] };
  assert.equal(snowWarning(w), "AVERTISSEMENT DE TEMPÊTE HIVERNALE");
  assert.equal(snowWarning({ ...w, warnings: [w.warnings[1]] }), "AVIS DE NEIGE");
  assert.equal(SNOW_THRESHOLD_CM, 5);
});

test("getForecast : échec réseau → null", async () => {
  assert.equal(await getForecast((async () => { throw new Error("réseau"); }) as unknown as typeof fetch), null);
});

test("getForecast : réponse HTTP en erreur → null", async () => {
  assert.equal(await getForecast((async () => new Response("x", { status: 500 })) as unknown as typeof fetch), null);
});

test("getForecast : fixture → Forecast", async () => {
  const f = await getForecast(okFetch);
  assert.equal(f?.source, "eccc");
});

test("getForecast : requête sans fin → null après le délai", async () => {
  const never = ((_u: unknown, init?: RequestInit) =>
    new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("abort"))))) as unknown as typeof fetch;
  const t0 = Date.now();
  assert.equal(await getForecast(never, 200), null);
  assert.ok(Date.now() - t0 < 6000);
});

test("source en cache : une requête sans fin, appelée deux fois, ne part qu'une fois ; l'échec est gardé pendant FAIL_TTL_MS", async () => {
  let calls = 0;
  // ignore même le signal d'abandon : seul le délai de la source y met fin
  const hang = (() => (calls++, new Promise(() => {}))) as unknown as typeof fetch;
  let clock = 1_000_000;
  const get = createForecastSource({ fetchImpl: hang, timeoutMs: 50, now: () => clock });
  const t0 = Date.now();
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a, null);
  assert.equal(b, null);
  assert.equal(calls, 1, "les deux appelants partagent la même requête");
  assert.ok(Date.now() - t0 < 2000);
  // dans le délai de l'échec : réponse immédiate, aucun nouvel appel à ECCC
  clock += FAIL_TTL_MS - 1;
  const t1 = Date.now();
  assert.equal(await get(), null);
  assert.ok(Date.now() - t1 < 20, "pas de nouvelle attente");
  assert.equal(calls, 1);
  // l'échec expiré : on réessaie
  clock += 2;
  await get();
  assert.equal(calls, 2);
});

test("source en cache : après une réussite puis un échec, la dernière prévision reçue est servie, marquée « stale »", async () => {
  let calls = 0;
  let up = true;
  const flaky = (async () => {
    calls++;
    if (!up) throw new Error("réseau");
    return new Response(JSON.stringify(qc130));
  }) as unknown as typeof fetch;
  let clock = 1_000_000;
  const get = createForecastSource({ fetchImpl: flaky, timeoutMs: 1000, now: () => clock });
  const good = await get();
  assert.equal(good?.source, "eccc");
  assert.equal(good?.stale, undefined);
  // 31 min plus tard, la prévision a expiré et ECCC ne répond plus
  up = false;
  clock += 31 * 60_000;
  const stale = await get();
  assert.equal(calls, 2);
  assert.equal(stale?.stale, true);
  assert.equal(stale?.issuedAt, good?.issuedAt);
  assert.deepEqual(stale?.periods, good?.periods);
  // pendant le délai de l'échec : la même prévision périmée, sans appel
  clock += 1000;
  assert.equal((await get())?.stale, true);
  assert.equal(calls, 2);
  // ECCC revient : prévision fraîche, plus marquée
  up = true;
  clock += FAIL_TTL_MS;
  assert.equal((await get())?.stale, undefined);
  assert.equal(calls, 3);
});

test("source en cache : une prévision de plus de 6 h n'est plus servie à la place d'une nouvelle", async () => {
  let up = true;
  const flaky = (async () => {
    if (!up) throw new Error("réseau");
    return new Response(JSON.stringify(qc130));
  }) as unknown as typeof fetch;
  let clock = 1_000_000;
  const get = createForecastSource({ fetchImpl: flaky, timeoutMs: 1000, now: () => clock });
  await get();
  up = false;
  clock += 6 * 3_600_000 + 1;
  assert.equal(await get(), null);
});
