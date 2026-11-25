/**
 * Météo de l'accueil : conditions actuelles (icône de 48 px, température), les prochaines heures et
 * les deux prochaines périodes d'Environnement Canada (icônes de 16 px), neige des prochaines 36 h et
 * source de la neige de la journée (réelle ou simulée), ou « Météo indisponible ».
 * Composant sans état ni effet : rendu par le serveur (page d'accueil) et par les tests. La météo est
 * réelle : les heures affichées suivent l'heure réelle (`now`), pas l'horloge simulée.
 */
import { hourLabel } from "@/lib/territoire/home";
import { isNightAt, METEO_ATTRIBUTION, SNOW_THRESHOLD_CM, snowTonightCm, type Forecast } from "@/lib/territoire/meteo";
import { snowSource } from "@/lib/territoire/neige";
import { isNightCode, weatherCondition } from "@/lib/territoire/weatherIcon";
import { WeatherIcon } from "./WeatherIcon";

/** « −1 °C » (vrai signe moins). */
function temp(c: number, unit = " °C"): string {
  const r = Math.round(c);
  return `${r < 0 ? "−" : ""}${Math.abs(r)}${unit}`;
}

/** Première phrase (le ciel) et celle des températures d'une période : « Dégagé · Minimum moins 4 ». */
function brief(summary: string): string {
  const sentences = summary.split(/\.\s+/).map((s) => s.replace(/\.$/, "").trim()).filter(Boolean);
  const temps = sentences.find((s) => /^(Maximum|Minimum|Températures?)/.test(s));
  return [sentences[0], temps && temps !== sentences[0] ? temps : null].filter(Boolean).join(" · ");
}

/** Titre d'avertissement d'ECCC (en capitales) en casse de phrase : « Bulletin météorologique spécial ». */
const sentenceCase = (s: string) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLocaleLowerCase("fr-CA") : s);

const cm = (x: number) => `${Math.round(x * 10) / 10}`.replace(".", ",");
const HOUR = 3_600_000;
/** Heures affichées, une toutes les deux heures, à partir de l'heure en cours. */
const HOURS_SHOWN = 6;

export function WeatherSummary({ forecast, now = Date.now() }: { forecast: Forecast | null; now?: number }) {
  const source = snowSource(forecast);
  const hours = forecast ? forecast.hourly.filter((h) => h.t > now - HOUR).filter((_, i) => i % 2 === 0).slice(0, HOURS_SHOWN) : [];
  const code = forecast?.current.iconCode ?? null;
  const night = forecast ? isNightAt(forecast, now) || (code !== null && isNightCode(code)) : false;
  return (
    <section className="tr-card tr-weather" aria-labelledby="tr-weather-h">
      <div className="tr-card-h">
        <h2 id="tr-weather-h">Météo à Trois-Rivières</h2>
        <span className="tr-tag">Données réelles</span>
      </div>
      {forecast ? (
        <>
          <div className="tr-weather-now">
            <WeatherIcon condition={weatherCondition(code, night)} night={night} size={48} />
            <p>
              {forecast.current.tempC !== null && <span className="tr-weather-temp">{temp(forecast.current.tempC)}</span>}
              <span className="tr-weather-cond">{forecast.current.condition || "Conditions actuelles non publiées"}</span>
            </p>
          </div>
          {hours.length > 0 && (
            <ol className="tr-weather-hours" aria-label="Prochaines heures">
              {hours.map((h) => {
                const n = isNightAt(forecast, h.t) || (h.iconCode !== null && isNightCode(h.iconCode));
                return (
                  <li key={h.t}>
                    <span className="tr-weather-h">{hourLabel(h.t).replace(/ 00$/, "")}</span>
                    <WeatherIcon condition={weatherCondition(h.iconCode, n)} night={n} size={16} label={h.condition || undefined} />
                    <span className="tr-weather-t">{h.tempC !== null ? temp(h.tempC, "°") : "—"}</span>
                  </li>
                );
              })}
            </ol>
          )}
          <dl className="tr-weather-periods">
            {forecast.periods.slice(0, 2).map((p) => (
              <div key={p.name}>
                <dt>{p.name}</dt>
                <dd>
                  <WeatherIcon condition={weatherCondition(p.iconCode, p.iconCode !== null && isNightCode(p.iconCode))} night={p.iconCode !== null && isNightCode(p.iconCode)} size={16} />
                  {brief(p.summary)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="tr-weather-snow">
            {snowTonightCm(forecast) > 0 ? (
              <>
                Neige annoncée, prochaines 36 h : <b>{cm(snowTonightCm(forecast))} cm</b>
              </>
            ) : (
              "Aucune neige annoncée dans les prochaines 36 h"
            )}
          </p>
          {forecast.warnings.map((w) => (
            <p key={w.title} className="tr-weather-warn">
              {sentenceCase(w.title)}
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
