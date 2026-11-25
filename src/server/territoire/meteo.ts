/** Météo réelle d'Environnement Canada (GéoMet, sans clé), en cache mémoire de 30 minutes. */
import "server-only";
import { parseCityPage, type Forecast } from "@/lib/territoire/meteo";

export const METEO_URL = "https://api.weather.gc.ca/collections/citypageweather-realtime/items/qc-130?f=json&lang=fr";

const TTL_MS = 30 * 60_000;

// Pas le cache de données de `fetch` : `fetchImpl` est injectable, et un échec ne doit pas être mémorisé.
// Mémo de module, utilisé seulement avec le `fetch` global.
let memo: { at: number; value: Forecast } | null = null;

/** Prévision de Trois-Rivières, ou null au moindre problème (réseau, délai, format). */
export async function getForecast(fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<Forecast | null> {
  const cacheable = fetchImpl === fetch;
  if (cacheable && memo && Date.now() - memo.at < TTL_MS) return memo.value;
  // minuterie ordinaire (pas AbortSignal.timeout, dont la minuterie ne retient pas la boucle d'événements)
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // la course garantit le délai même si fetchImpl ignore le signal
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Error("délai dépassé"));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetchImpl(METEO_URL, { signal: ctl.signal, headers: { accept: "application/json" } }), timedOut]);
    if (!res.ok) return null;
    const value = parseCityPage(await Promise.race([res.json(), timedOut]));
    if (!value) return null;
    if (cacheable) memo = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
