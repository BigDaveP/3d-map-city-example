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
