/**
 * Météo réelle d'Environnement Canada (GéoMet, sans clé), en cache mémoire : une prévision reçue est
 * gardée 30 minutes, un échec 90 secondes, les appels simultanés partagent la même requête, et après
 * un échec la dernière prévision reçue est servie, marquée `stale`.
 */
import "server-only";
import { parseCityPage, type Forecast } from "@/lib/territoire/meteo";

export const METEO_URL = "https://api.weather.gc.ca/collections/citypageweather-realtime/items/qc-130?f=json&lang=fr";

const TTL_MS = 30 * 60_000;
/** Un échec est mémorisé : une API muette ne coûte pas 5 s à chaque requête de l'accueil. */
export const FAIL_TTL_MS = 90_000;
/** Au-delà, la dernière prévision reçue est trop vieille pour être servie à la place d'une nouvelle. */
const STALE_MAX_MS = 6 * 3_600_000;

/** Un appel à ECCC, sans cache : la prévision de Trois-Rivières, ou null au moindre problème (réseau, délai, format). */
async function fetchForecast(fetchImpl: typeof fetch, timeoutMs: number): Promise<Forecast | null> {
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
    return parseCityPage(await Promise.race([res.json(), timedOut]));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ForecastSourceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** horloge (ms), injectable pour les tests */
  now?: () => number;
}

/**
 * Prévision avec cache. Pas le cache de données de `fetch` : `fetchImpl` est injectable, et un échec
 * doit être mémorisé moins longtemps qu'une réussite.
 * - réussite : gardée 30 min ;
 * - échec : gardé 90 s, sans nouvel appel à ECCC pendant ce temps ;
 * - appels simultanés : une seule requête, dont tous attendent le résultat ;
 * - après un échec : la dernière prévision reçue (moins de 6 h), avec `stale: true`, sinon null.
 */
export function createForecastSource({ fetchImpl = fetch, timeoutMs = 5000, now = Date.now }: ForecastSourceOptions = {}): () => Promise<Forecast | null> {
  let memo: { at: number; value: Forecast | null } | null = null;
  let lastGood: { at: number; value: Forecast } | null = null;
  let inflight: Promise<Forecast | null> | null = null;
  const serve = (): Forecast | null => {
    if (memo?.value) return memo.value;
    return lastGood && now() - lastGood.at < STALE_MAX_MS ? { ...lastGood.value, stale: true } : null;
  };
  return () => {
    if (memo && now() - memo.at < (memo.value ? TTL_MS : FAIL_TTL_MS)) return Promise.resolve(serve());
    inflight ??= fetchForecast(fetchImpl, timeoutMs).then((value) => {
      const at = now();
      memo = { at, value };
      if (value) lastGood = { at, value };
      inflight = null;
      return serve();
    });
    return inflight;
  };
}

/** Source du serveur (fetch global), partagée par l'accueil et `/api/territoire/meteo`. */
const shared = createForecastSource();

/**
 * Prévision de Trois-Rivières, ou null si ECCC ne répond pas et qu'aucune prévision récente n'a été
 * reçue. Avec le `fetch` global : la source en cache. Avec un autre `fetchImpl` (tests) : un appel
 * direct, sans cache.
 */
export function getForecast(fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<Forecast | null> {
  return fetchImpl === fetch ? shared() : fetchForecast(fetchImpl, timeoutMs);
}
