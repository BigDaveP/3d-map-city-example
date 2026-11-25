/**
 * Météo de l'accueil : conditions actuelles et prochaines périodes d'Environnement Canada, neige des
 * prochaines 36 h et source de la neige de la journée (réelle ou simulée), ou « Météo indisponible ».
 * Composant sans état ni effet : rendu par le serveur (page d'accueil) et par les tests.
 */
import { hourLabel } from "@/lib/territoire/home";
import { METEO_ATTRIBUTION, SNOW_THRESHOLD_CM, snowTonightCm, type Forecast } from "@/lib/territoire/meteo";
import { snowSource } from "@/lib/territoire/neige";

/** « −1 °C » (vrai signe moins). */
function temp(c: number): string {
  const r = Math.round(c);
  return `${r < 0 ? "−" : ""}${Math.abs(r)} °C`;
}

/** Première phrase (le ciel) et celle des températures d'une période : « Dégagé · Minimum moins 4 ». */
function brief(summary: string): string {
  const sentences = summary.split(/\.\s+/).map((s) => s.replace(/\.$/, "").trim()).filter(Boolean);
  const temps = sentences.find((s) => /^(Maximum|Minimum|Températures?)/.test(s));
  return [sentences[0], temps && temps !== sentences[0] ? temps : null].filter(Boolean).join(" · ");
}

const cm = (x: number) => `${Math.round(x * 10) / 10}`.replace(".", ",");

export function WeatherSummary({ forecast }: { forecast: Forecast | null }) {
  const source = snowSource(forecast);
  return (
    <section className="tr-card tr-weather" aria-labelledby="tr-weather-h">
      <div className="tr-card-h">
        <h2 id="tr-weather-h">Météo à Trois-Rivières</h2>
        <span className="tr-tag">Données réelles</span>
      </div>
      {forecast ? (
        <>
          <p className="tr-weather-now">
            {forecast.current.tempC !== null && <span className="tr-weather-temp">{temp(forecast.current.tempC)}</span>}
            <span>{forecast.current.condition || "Conditions actuelles non publiées"}</span>
          </p>
          <dl className="tr-weather-periods">
            {forecast.periods.slice(0, 2).map((p) => (
              <div key={p.name}>
                <dt>{p.name}</dt>
                <dd>{brief(p.summary)}</dd>
              </div>
            ))}
          </dl>
          <p className="tr-weather-snow">
            {snowTonightCm(forecast) > 0 ? (
              <>
                Neige annoncée, prochaines 36 h : <b>{cm(snowTonightCm(forecast))} cm</b>
              </>
            ) : (
              "Aucune neige annoncée dans les prochaines 36 h."
            )}
          </p>
          {forecast.warnings.map((w) => (
            <p key={w.title} className="tr-weather-warn">
              {w.title}
            </p>
          ))}
          {source.kind === "simulation" && (
            <p className="tr-weather-sim">
              <span className="tr-sim">Simulation</span> La prévision réelle n&apos;annonce pas de neige (seuil {SNOW_THRESHOLD_CM} cm) : la journée scénarisée garde
              ses {source.cm} cm simulés.
            </p>
          )}
          {forecast.issuedAt && Number.isFinite(Date.parse(forecast.issuedAt)) && (
            <p className="tr-weather-issued">Prévision publiée à {hourLabel(Date.parse(forecast.issuedAt))}</p>
          )}
        </>
      ) : (
        <div className="tr-weather-off" role="status">
          <b>Météo indisponible</b>
          <p>
            L&apos;API d&apos;Environnement Canada n&apos;a pas répondu. La démo continue avec la neige simulée ({source.cm} cm,{" "}
            <span className="tr-sim">Simulation</span>).
          </p>
        </div>
      )}
      <p className="tr-attrib">{METEO_ATTRIBUTION}</p>
    </section>
  );
}
