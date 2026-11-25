/** Lecture des résultats du banc (bench/results/aqueduc.csv et aqueduc-meta.json), moyennés sur les répétitions. */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "bench", "results");

/** Banc de la démo réseau d'eau (`bench/run-aqueduc.ts`) : une ligne par configuration et phase. */
export interface AqueducRow {
  mode: string;
  tags: number;
  underground: string;
  tubes: string;
  phase: string;
  /** répétitions moyennées */
  rep: number;
  [metric: string]: number | string;
}

const AQ_TEXT = ["mode", "underground", "tubes", "phase"];

export function readAqueducCsv(): string | null {
  try {
    return readFileSync(path.join(DIR, "aqueduc.csv"), "utf8");
  } catch {
    return null;
  }
}

/**
 * Lignes par (mode, étiquettes, souterrain, tubes, phase), et méta. Une cellule vide du CSV (rien
 * mesuré) vaut NaN, jamais 0. Métriques : moyenne des répétitions qui en ont une valeur. Latences
 * p50/p95 : moyenne pondérée par le nombre d'échantillons des répétitions qui en ont (`latWeighted`
 * quand plusieurs répétitions y contribuent) ; `latSamples` : total des échantillons.
 */
export function loadAqueducBench(): { rows: AqueducRow[]; meta: Record<string, unknown> | null } | null {
  const csv = readAqueducCsv();
  if (!csv) return null;
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const groups = new Map<string, Record<string, number | string>[]>();
  for (const l of lines) {
    const v = l.split(",");
    const r: Record<string, number | string> = {};
    cols.forEach((c, i) => (r[c] = AQ_TEXT.includes(c) ? v[i] : v[i] === undefined || v[i] === "" ? NaN : Number(v[i])));
    const k = `${r.mode}|${r.tags}|${r.underground}|${r.tubes}|${r.phase}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const LAT = ["latP50", "latP95"];
  const rows = [...groups.values()].map((g) => {
    const out = { ...g[0] } as AqueducRow;
    for (const c of cols) {
      if ([...AQ_TEXT, "tags", "rep", "latSamples", ...LAT].includes(c)) continue;
      const vals = g.map((r) => Number(r[c])).filter(Number.isFinite);
      out[c] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
    }
    const withLat = g.filter((r) => Number(r.latSamples) > 0 && Number.isFinite(Number(r.latP50)));
    const n = withLat.reduce((a, r) => a + Number(r.latSamples), 0);
    for (const c of LAT) out[c] = n ? withLat.reduce((a, r) => a + Number(r[c]) * Number(r.latSamples), 0) / n : NaN;
    out.latSamples = g.reduce((a, r) => a + (Number(r.latSamples) || 0), 0);
    out.latWeighted = withLat.length > 1 ? 1 : 0;
    out.rep = g.length;
    return out;
  });
  let meta: Record<string, unknown> | null = null;
  try {
    meta = JSON.parse(readFileSync(path.join(DIR, "aqueduc-meta.json"), "utf8"));
  } catch {}
  return { rows, meta };
}
