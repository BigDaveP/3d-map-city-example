import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCityPage, snowTonightCm, snowWarning, SNOW_THRESHOLD_CM, type Forecast } from "../src/lib/territoire/meteo";
import { getForecast } from "../src/server/territoire/meteo";

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
