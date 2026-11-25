/** Lecture des résultats du banc (bench/results/*.csv|json), moyennés sur les répétitions. */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface BenchRow {
  campaign: string;
  n: number;
  config: string;
  speed: number;
  budget: string;
  phase: string;
  [metric: string]: number | string;
}

const DIR = path.join(process.cwd(), "bench", "results");
const TEXT = ["campaign", "config", "budget", "phase"];

export function readCsv(): string | null {
  try {
    return readFileSync(path.join(DIR, "results.csv"), "utf8");
  } catch {
    return null;
  }
}

export function loadBench(): { rows: BenchRow[]; meta: Record<string, unknown> | null; reps: number } | null {
  const csv = readCsv();
  if (!csv) return null;
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const raw = lines.map((l) => {
    const v = l.split(",");
    const r: Record<string, number | string> = {};
    cols.forEach((c, i) => (r[c] = TEXT.includes(c) ? v[i] : Number(v[i])));
    return r as BenchRow;
  });
  // moyenne des répétitions par (n, config, phase)
  const groups = new Map<string, BenchRow[]>();
  for (const r of raw) {
    const k = `${r.campaign}|${r.n}|${r.config}|${r.speed}|${r.budget}|${r.phase}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rows = [...groups.values()].map((g) => {
    const out: BenchRow = { ...g[0] };
    for (const c of cols) if (![...TEXT, "n", "speed", "rep"].includes(c)) out[c] = g.reduce((a, r) => a + Number(r[c]), 0) / g.length;
    out.rep = g.length;
    return out;
  });
  let meta: Record<string, unknown> | null = null;
  try {
    meta = JSON.parse(readFileSync(path.join(DIR, "meta.json"), "utf8"));
  } catch {}
  return { rows, meta, reps: Math.max(...rows.map((r) => Number(r.rep))) };
}

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

/** Lignes moyennées sur les répétitions par (mode, étiquettes, souterrain, tubes, phase), et méta. */
export function loadAqueducBench(): { rows: AqueducRow[]; meta: Record<string, unknown> | null } | null {
  const csv = readAqueducCsv();
  if (!csv) return null;
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const groups = new Map<string, Record<string, number | string>[]>();
  for (const l of lines) {
    const v = l.split(",");
    const r: Record<string, number | string> = {};
    cols.forEach((c, i) => (r[c] = AQ_TEXT.includes(c) ? v[i] : Number(v[i])));
    const k = `${r.mode}|${r.tags}|${r.underground}|${r.tubes}|${r.phase}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rows = [...groups.values()].map((g) => {
    const out = { ...g[0] } as AqueducRow;
    for (const c of cols) if (![...AQ_TEXT, "tags", "rep"].includes(c)) out[c] = g.reduce((a, r) => a + Number(r[c]), 0) / g.length;
    // échantillons de latence : total des répétitions (les percentiles restent des moyennes)
    out.latSamples = g.reduce((a, r) => a + Number(r.latSamples), 0);
    out.rep = g.length;
    return out;
  });
  let meta: Record<string, unknown> | null = null;
  try {
    meta = JSON.parse(readFileSync(path.join(DIR, "aqueduc-meta.json"), "utf8"));
  } catch {}
  return { rows, meta };
}
