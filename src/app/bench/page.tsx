import Link from "next/link";
import { loadBench, type BenchRow } from "@/server/bench";
import { Bars, Legend, type Series } from "./Bars";
import "./bench.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Banc — DOM virtualisé vs HTML-in-Canvas" };

const SERIES: Series[] = [
  { key: "dom", label: "DOM virtualisé", color: "--series-1" },
  { key: "canvas-atlas", label: "HTML-in-Canvas (atlas)", color: "--series-2" },
  { key: "canvas-percard", label: "HTML-in-Canvas (1 texture / carte)", color: "--series-3" },
];
const PHASES: Record<string, string> = {
  "0-parcours-complet": "Parcours complet",
  "1-vue-ensemble": "Vue d'ensemble",
  "2-zoom-region": "Zoom région",
  "3-pan-region": "Pan région",
  "4-zoom-carte": "Zoom carte",
  "5-saisie-note": "Saisie note",
  "6-dezoom": "Dézoom",
  "7-tempete": "Tempête (éloigné)",
  "8-tempete-region": "Tempête (intermédiaire)*",
};
// libellés d'axe courts (8 groupes dans ~460 px)
const SHORT: Record<string, string> = {
  "1-vue-ensemble": "Ensemble",
  "2-zoom-region": "Région",
  "3-pan-region": "Pan",
  "4-zoom-carte": "Carte",
  "5-saisie-note": "Saisie",
  "6-dezoom": "Dézoom",
  "7-tempete": "Tempête",
  "8-tempete-region": "Tempête*",
};
const COLS: [string, string, number][] = [
  ["fps", "FPS", 1],
  ["frameP50", "Frame p50 (ms)", 1],
  ["frameP95", "Frame p95 (ms)", 1],
  ["workP95", "JS p95 (ms)", 1],
  ["latP50", "Latence p50 (ms)", 0],
  ["latP95", "Latence p95 (ms)", 0],
  ["capturesTotal", "Captures", 0],
  ["captureMsAvg", "ms / capture", 2],
  ["queueMax", "File max", 0],
  ["gpuMB", "Textures (Mo)", 0],
  ["domNodes", "Nœuds DOM", 0],
  ["mounted", "Cartes montées", 0],
];

export default function BenchPage() {
  const data = loadBench();
  if (!data) {
    return (
      <main className="bench">
        <h1>Banc de mesures</h1>
        <p>Aucun résultat. Lancez <code>npm run bench</code> (voir README).</p>
      </main>
    );
  }
  const { rows: allRows, meta, reps } = data;
  // campagne principale (250-1000) + extrapolation (2500, 5000 : DOM et atlas seulement)
  const rows = allRows.filter((r) => r.campaign === "principal" || r.campaign === "echelle");
  const get = (n: number | string, config: string, phase: string) => rows.find((r) => r.n === Number(n) && r.config === config && r.phase === phase);
  const speedRows = allRows.filter((r) => r.campaign === "vitesse" || (r.campaign === "principal" && r.n === 1000 && r.config !== "canvas-percard"));
  const speeds = [...new Set(speedRows.map((r) => r.speed))].sort((a, b) => a - b);
  const bySpeed = (metric: string) => (sp: number | string, c: string) =>
    num(speedRows.find((r) => r.speed === Number(sp) && r.config === c && r.n === 1000 && r.phase === "0-parcours-complet")?.[metric]);
  const budgetRows = allRows.filter((r) => r.campaign === "budget" && r.phase === "0-parcours-complet");
  const budgets = [...new Set(budgetRows.map((r) => r.budget))].sort((a, b) => Number(a.split(":")[0]) - Number(b.split(":")[0]));
  const counts = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b);
  const total = (metric: string) => (n: number | string, c: string) => num(get(n, c, "0-parcours-complet")?.[metric]);
  const nMax = 1000; // détail par phase : dernière taille de la campagne principale
  const phases = Object.keys(PHASES).filter((p) => p !== "0-parcours-complet");
  const cardsLabel = (g: string | number) => (Number(g) > 1000 ? `${g}*` : `${g}`);
  return (
    <main className="bench viz-root">
      <p className="sim-banner" role="note">⚠️ Données simulées — mesures prises sur la machine décrite ci-dessous.</p>
      <h1>Banc : DOM virtualisé vs HTML-in-Canvas</h1>
      <p className="lead">
        Même mur, même parcours (vitesse ×10) : vue d&apos;ensemble → zoom région → pan → zoom carte → saisie → dézoom → tempête. Moyenne de {reps} répétition
        {reps > 1 ? "s" : ""}. <a href="/bench/results.csv">Télécharger le CSV</a> · <Link href="/">Retour au mur</Link>
      </p>
      {meta && (
        <p className="meta">
          {String(meta.browser)} · WebGL : {String(meta.webgl)} · CPU : {String(meta.cpu)} · {String(meta.memoryGB)} Go · vue {(meta.viewport as { width: number }).width}×
          {(meta.viewport as { height: number }).height} · budget {JSON.stringify(meta.budget)} · {String(meta.date).slice(0, 16).replace("T", " ")}
        </p>
      )}
      {String(meta?.webgl ?? "").includes("SwiftShader") && (
        <p className="warn">
          WebGL est ici <strong>logiciel</strong> (SwiftShader, sans GPU) : chaque redessin du canvas coûte du CPU. Les écarts de FPS pénalisent le mode canvas plus
          qu&apos;un vrai GPU ne le ferait ; les nombres de captures, la latence et la mémoire restent comparables.
        </p>
      )}
      <Legend series={SERIES} />
      <h2>Parcours complet, par nombre de cartes</h2>
      <p className="note">* 2 500 et 5 000 : extrapolation au-delà du cahier des charges (DOM et canvas + atlas seulement, une répétition).</p>
      <div className="charts">
        <Bars title="FPS moyen" unit="images/s" groups={counts} groupLabel={cardsLabel} series={SERIES} value={total("fps")} note="plus haut = mieux" />
        <Bars title="Temps de frame p95" unit="ms" groups={counts} groupLabel={cardsLabel} series={SERIES} value={total("frameP95")} note="pire phase" />
        <Bars title="Temps JS par frame p95" unit="ms" groups={counts} groupLabel={cardsLabel} series={SERIES} value={total("workP95")} note="rAF + commit React + paint" />
        <Bars title="Latence donnée → pixel p95" unit="ms" groups={counts} groupLabel={cardsLabel} series={SERIES} value={total("latP95")} digits={0} />
        <Bars title="Captures HTML" unit="captures" groups={counts} groupLabel={cardsLabel} series={SERIES} value={total("capturesTotal")} digits={0} note="0 en DOM" />
        <Bars title="Nœuds DOM (max)" unit="nœuds" groups={counts} groupLabel={cardsLabel} series={SERIES} value={total("domNodes")} digits={0} />
        <Bars title="Mémoire textures (max)" unit="Mo" groups={counts} groupLabel={cardsLabel} series={SERIES} value={total("gpuMB")} digits={0} note="estimation" />
        <Bars title="Tas JS (max)" unit="Mo" groups={counts} groupLabel={cardsLabel} series={SERIES} value={total("heapMB")} digits={0} />
      </div>
      <h2>Par phase, {nMax} cartes</h2>
      <div className="charts">
        {(["frameP95", "fps", "capturesTotal", "latP95"] as const).map((m) => (
          <Bars
            key={m}
            title={m === "frameP95" ? "Temps de frame p95" : m === "fps" ? "FPS" : m === "capturesTotal" ? "Captures" : "Latence p95"}
            unit={m === "fps" ? "images/s" : m === "capturesTotal" ? "captures" : "ms"}
            groups={phases}
            groupLabel={(g) => SHORT[String(g)] ?? String(g)}
            series={SERIES}
            value={(g, c) => num(get(nMax, c, String(g))?.[m])}
            digits={m === "fps" || m === "frameP95" ? 1 : 0}
          />
        ))}
      </div>
      {speeds.length > 1 && (
        <>
          <h2>Fréquence de mise à jour (1 000 cartes)</h2>
          <div className="charts">
            {(["frameP95", "workP95", "latP95", "capturesTotal"] as const).map((m) => (
              <Bars
                key={m}
                title={m === "frameP95" ? "Temps de frame p95" : m === "workP95" ? "Temps JS p95" : m === "latP95" ? "Latence p95" : "Captures"}
                unit={m === "capturesTotal" ? "captures" : "ms"}
                groups={speeds}
                groupLabel={(g) => `vitesse ×${g}`}
                series={SERIES.slice(0, 2)}
                value={bySpeed(m)}
                digits={m === "frameP95" || m === "workP95" ? 1 : 0}
              />
            ))}
          </div>
        </>
      )}
      {budgets.length > 1 && (
        <>
          <h2>Budget de recaptures (1 000 cartes, vitesse ×100, atlas)</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Budget (captures : ms par frame)</th>
                  {COLS.slice(0, 9).map(([, l]) => (
                    <th key={l} scope="col">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {budgets.map((bu) => {
                  const r = budgetRows.find((x) => x.budget === bu)!;
                  return (
                    <tr key={bu}>
                      <th scope="row">{bu}</th>
                      {COLS.slice(0, 9).map(([k, , d]) => (
                        <td key={k} className="num">
                          {Number(r[k]).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d })}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="note">* Phase supplémentaire hors parcours demandé : tempête déclenchée au zoom intermédiaire (30 % des cartes visibles à recapturer).</p>
      <h2>Tableaux</h2>
      {counts.map((n) => (
        <details key={n} open={n === nMax}>
          <summary>{n} cartes</summary>
          <Table rows={rows.filter((r) => r.n === n)} />
        </details>
      ))}
    </main>
  );
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function Table({ rows }: { rows: BenchRow[] }) {
  const sorted = rows.slice().sort((a, b) => a.phase.localeCompare(b.phase) || SERIES.findIndex((s) => s.key === a.config) - SERIES.findIndex((s) => s.key === b.config));
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Phase</th>
            <th scope="col">Configuration</th>
            {COLS.map(([, l]) => (
              <th key={l} scope="col">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.phase}-${r.config}`} className={r.phase.startsWith("0-") ? "total" : ""}>
              <th scope="row">{PHASES[r.phase] ?? r.phase}</th>
              <td>{SERIES.find((s) => s.key === r.config)?.label ?? r.config}</td>
              {COLS.map(([k, , d]) => (
                <td key={k} className="num">
                  {Number(r[k]).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
