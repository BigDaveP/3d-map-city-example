"use client";
/**
 * Météo du panneau du déneigement : neige des prochaines 36 h et sa source (« Environnement Canada »
 * quand la vraie prévision annonce assez de neige ou un avertissement, sinon « Simulation »),
 * avertissement en cours, crédit de la météo. Prévision périmée servie par le cache du serveur
 * (`stale`) : elle le dit. API indisponible : « Météo indisponible », la journée
 * garde sa neige simulée, et « Réessayer » redemande la prévision (le store réessaie aussi seul).
 */
import { METEO_ATTRIBUTION, SNOW_THRESHOLD_CM, snowTonightCm, snowWarning, warningTitle } from "@/lib/territoire/meteo";
import { snowSource } from "@/lib/territoire/neige";
import { loadForecast } from "../../store";
import { useTerritoire } from "../../useTerritoire";

const cm = (x: number) => `${Math.round(x * 10) / 10}`.replace(".", ",");

export function WeatherCard() {
  const forecast = useTerritoire((s) => s.forecast);
  const loading = forecast === "chargement";
  const f = loading ? null : forecast;
  const source = snowSource(f);
  const warning = f && snowWarning(f);
  return (
    <section className="dn-weather" aria-labelledby="dn-weather-h" aria-busy={loading}>
      <div className="dn-weather-h">
        <h3 id="dn-weather-h">Neige · prochaines 36 h</h3>
        <p className="dn-weather-cm">
          <span className="aq-num">{cm(source.cm)}</span> cm
        </p>
        <span className="dn-src" data-src={source.kind}>
          {source.kind === "eccc" ? "Environnement Canada" : "Simulation"}
        </span>
      </div>
      {loading && <p className="dn-weather-note">Prévision en cours de chargement…</p>}
      {f === null && !loading && (
        <div className="dn-weather-off" role="status">
          <p>
            <b>Météo indisponible</b> : l&apos;API d&apos;Environnement Canada n&apos;a pas répondu. La journée garde sa neige simulée.
          </p>
          <button type="button" className="aq-btn" onClick={() => void loadForecast({ force: true })}>
            Réessayer
          </button>
        </div>
      )}
      {f && source.kind === "simulation" && (
        <p className="dn-weather-note">
          Prévision réelle : {cm(snowTonightCm(f))} cm, sous le seuil de {SNOW_THRESHOLD_CM} cm
        </p>
      )}
      {f?.stale && <p className="dn-weather-note">Dernière prévision reçue : Environnement Canada ne répond pas pour l&apos;instant.</p>}
      {warning && (
        <p className="dn-weather-warn" role="note">
          {warningTitle(warning)}
        </p>
      )}
      <p className="dn-credit">{METEO_ATTRIBUTION}</p>
    </section>
  );
}
