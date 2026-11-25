/**
 * Météo d'Environnement Canada (GéoMet, citypageweather) : lecture d'une fiche de ville et seuils de neige.
 * Module pur, sans réseau. Les valeurs bilingues sont de la forme { en, fr } ; on lit le français.
 */

export interface Forecast {
  source: "eccc";
  issuedAt: string;
  /** `iconCode` : code d'icône d'ECCC (0 à 48, voir weatherIcon.ts), null s'il n'est pas publié */
  current: { tempC: number | null; condition: string; iconCode: number | null };
  periods: { name: string; summary: string; snowCm: number | null; rainMm: number | null; iconCode: number | null }[];
  hourly: { t: number; tempC: number | null; condition: string; pop: number | null; iconCode: number | null }[];
  warnings: { title: string; type: string; expires: string }[];
  /** lever et coucher du soleil du jour de la fiche (ms), null s'ils ne sont pas publiés */
  sun: { rise: number; set: number } | null;
}

export const SNOW_THRESHOLD_CM = 5;

export const METEO_ATTRIBUTION = "Météo : Environnement et Changement climatique Canada (Licence du gouvernement ouvert – Canada)";

/**
 * Périodes comptées pour « cette nuit ». La spec en annonce deux, mais la fiche réelle de référence place
 * la neige à la troisième (aujourd'hui, ce soir, puis le lendemain) : on couvre les 24 h à venir.
 */
const TONIGHT_PERIODS = 3;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valeur française d'un champ bilingue, ou la valeur telle quelle si elle ne l'est pas. */
function fr(v: unknown): unknown {
  return isObj(v) && "fr" in v ? v.fr : v;
}
const str = (v: unknown): string => {
  const x = fr(v);
  return typeof x === "string" ? x : "";
};
const num = (v: unknown): number | null => {
  const x = fr(v);
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Code d'icône d'ECCC (`{ value: 0, url, format }`) : entier de 0 à 48, sinon null. */
const icon = (v: unknown): number | null => {
  const n = isObj(v) ? num(v.value) : null;
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 48 ? n : null;
};
const DAY_MS = 86_400_000;

export function parseCityPage(feature: unknown): Forecast | null {
  if (!isObj(feature) || !isObj(feature.properties)) return null;
  const p = feature.properties;
  if (!isObj(p.forecastGroup) || !Array.isArray(p.forecastGroup.forecasts)) return null;
  const cur = isObj(p.currentConditions) ? p.currentConditions : {};

  const periods = p.forecastGroup.forecasts.filter(isObj).map((f) => {
    const acc = isObj(f.precipitation) && isObj(f.precipitation.accumulation) ? f.precipitation.accumulation : null;
    const amount = acc && isObj(acc.amount) ? num(acc.amount.value) : null;
    const units = acc && isObj(acc.amount) ? str(acc.amount.units) : "";
    const kind = acc ? str(acc.name).toLowerCase() : "";
    const isSnow = amount !== null && kind.includes("neige");
    const isRain = amount !== null && kind.includes("pluie");
    return {
      name: isObj(f.period) ? str(f.period.textForecastName) : "",
      summary: str(f.textSummary),
      snowCm: isSnow ? (units === "mm" ? amount / 10 : amount) : null,
      rainMm: isRain ? (units === "cm" ? amount * 10 : amount) : null,
      iconCode: isObj(f.abbreviatedForecast) ? icon(f.abbreviatedForecast.icon) : null,
    };
  });
  if (periods.length === 0) return null;

  const hourlyRaw = isObj(p.hourlyForecastGroup) ? arr(p.hourlyForecastGroup.hourlyForecasts) : [];
  const hourly = hourlyRaw.filter(isObj).flatMap((h) => {
    const t = Date.parse(str(h.timestamp));
    if (!Number.isFinite(t)) return [];
    return [{ t, tempC: isObj(h.temperature) ? num(h.temperature.value) : null, condition: str(h.condition), pop: isObj(h.lop) ? num(h.lop.value) : null, iconCode: icon(h.iconCode) }];
  });

  const rs = isObj(p.riseSet) ? p.riseSet : {};
  const rise = Date.parse(str(rs.sunrise));
  const set = Date.parse(str(rs.sunset));

  const warnings = arr(p.warnings).filter(isObj).map((w) => ({ title: str(w.description), type: str(w.type), expires: str(w.expiryTime) }));

  return {
    source: "eccc",
    issuedAt: str(p.lastUpdated),
    current: { tempC: isObj(cur.temperature) ? num(cur.temperature.value) : null, condition: str(cur.condition), iconCode: icon(cur.iconCode) },
    periods,
    hourly,
    warnings,
    sun: Number.isFinite(rise) && Number.isFinite(set) && set > rise ? { rise, set } : null,
  };
}

/** Neige attendue d'ici la nuit prochaine (cm), somme des premières périodes de la prévision. */
export function snowTonightCm(f: Forecast): number {
  return f.periods.slice(0, TONIGHT_PERIODS).reduce((s, p) => s + (p.snowCm ?? 0), 0);
}

/** Titre d'un avertissement qui parle de neige ou d'hiver, sinon null. */
export function snowWarning(f: Forecast): string | null {
  return f.warnings.find((w) => /NEIGE|HIVER/.test(w.title.toUpperCase()))?.title ?? null;
}

/**
 * Nuit à l'instant t, d'après le lever et le coucher du soleil de la fiche (reportés de jour en jour :
 * quelques minutes d'écart sur les 24 h de la prévision horaire). Sans eux : jour.
 */
export function isNightAt(f: Pick<Forecast, "sun">, t: number): boolean {
  if (!f.sun) return false;
  const since = (((t - f.sun.rise) % DAY_MS) + DAY_MS) % DAY_MS;
  return since >= f.sun.set - f.sun.rise;
}

/** Titre d'avertissement d'ECCC (publié en capitales) en casse de phrase : « Bulletin météorologique spécial ». */
export function warningTitle(title: string): string {
  return title === title.toUpperCase() ? title.charAt(0) + title.slice(1).toLocaleLowerCase("fr-CA") : title;
}
