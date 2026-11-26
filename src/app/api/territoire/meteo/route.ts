/**
 * Météo réelle d'Environnement Canada : { forecast, attribution }, forecast nul si indisponible, ou
 * la dernière prévision reçue marquée `stale`. Ni un échec ni une prévision périmée ne sont mis en
 * cache par le navigateur : l'essai suivant interroge à nouveau le serveur.
 */
import { METEO_ATTRIBUTION } from "@/lib/territoire/meteo";
import { getForecast } from "@/server/territoire/meteo";

export const dynamic = "force-dynamic";

export async function GET() {
  const forecast = await getForecast();
  return Response.json({ forecast, attribution: METEO_ATTRIBUTION }, { headers: { "cache-control": forecast && !forecast.stale ? "public, max-age=300" : "no-store" } });
}
