/** Météo réelle d'Environnement Canada : { forecast, attribution }, forecast nul si indisponible. */
import { METEO_ATTRIBUTION } from "@/lib/territoire/meteo";
import { getForecast } from "@/server/territoire/meteo";

export const dynamic = "force-dynamic";

export async function GET() {
  const forecast = await getForecast();
  return Response.json({ forecast, attribution: METEO_ATTRIBUTION }, { headers: { "cache-control": "public, max-age=300" } });
}
