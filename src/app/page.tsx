import type { Metadata, Viewport } from "next";
import { Home } from "@/client/territoire/home/Home";
import { WeatherSummary } from "@/client/territoire/home/Weather";
import "@/client/territoire/home/home.css";
import { homeSnapshot, type Mode } from "@/lib/territoire/home";
import { getForecast } from "@/server/territoire/meteo";

export const metadata: Metadata = {
  title: "Vue d'ensemble · Territoire · Trois-Rivières (démo non officielle)",
  description:
    "Démo non officielle de gestion du territoire : alertes de la ville, environnements Aqueduc et Déneigement en 3D, météo d'Environnement Canada, données ouvertes et simulation.",
};

/** Barre claire du navigateur, comme celle de l'accueil. */
export const viewport: Viewport = { themeColor: "#ffffff" };

/**
 * Accueil : l'état de la ville à l'heure actuelle, sans action de visiteur (ce que voit quelqu'un
 * qui arrive), rendu par le serveur et lisible sans JavaScript ; l'îlot client le recalcule ensuite
 * avec l'horloge et les décisions du visiteur. `?mode=classic|hic` n'a pas d'effet ici (pas de
 * carte) : il est transmis aux liens vers les vues 3D.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { mode } = await searchParams;
  const m: Mode | null = mode === "classic" || mode === "hic" ? mode : null;
  // délai de 5 s au plus, cache de 30 min ; null si indisponible (neige simulée)
  const forecast = await getForecast();
  // alertes : allAlerts(maintenant, aucune action, snowSource(prévision)), avec l'état de chaque environnement
  const snapshot = homeSnapshot(Date.now(), [], forecast, m);
  return <Home snapshot={snapshot} forecast={forecast} mode={m} weather={<WeatherSummary forecast={forecast} />} />;
}
