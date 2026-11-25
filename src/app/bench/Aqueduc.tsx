/**
 * Section « Réseau d'eau » de `/bench` : résultats de `bench/run-aqueduc.ts` (mode classique vs
 * HTML-in-Canvas, 20 / 60 / 120 étiquettes, phases séparées), rendu serveur.
 */
import Link from "next/link";
import { loadAqueducBench, type AqueducRow } from "@/server/bench";
import { Bars, Legend, type Series } from "./Bars";

const SERIES: Series[] = [
  { key: "classic", label: "Classique (marqueurs DOM)", color: "--series-1" },
  { key: "hic", label: "HTML-in-Canvas", color: "--series-2" },
];
const PHASES: Record<string, string> = {
  "1-rotation": "Rotation 90°",
  "2-immobile": "Immobile, horloge ×60",
  "3-scenario": "Scénario (5 étapes)",
};
const COLS: [string, string, number][] = [
  ["fps", "FPS", 1],
  ["frameP50", "Frame p50 (ms)", 1],
  ["frameP95", "Frame p95 (ms)", 1],
  ["workP95", "JS / image p95 (ms)", 1],
  ["workMax", "JS / image max (ms)", 1],
  ["updP95", "JS / mise à jour p95 (ms)", 1],
  ["updMax", "JS / mise à jour max (ms)", 1],
  ["capturesPerMin", "Captures / min", 0],
  ["latP50", "Latence p50 (ms) *", 0],
  ["latP95", "Latence p95 (ms) *", 0],
  ["latSamples", "Échantillons (total)", 0],
  ["occlMsAvg", "Occlusion (ms / requête) †", 1],
  ["tubeInstances", "Tubes (instances)", 0],
];

const fmt = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function AqueducSection() {
  const data = loadAqueducBench();
  return (
    <section id="aqueduc" aria-labelledby="aqueduc-h">
      <h2 id="aqueduc-h">Réseau d&apos;eau : classique vs HTML-in-Canvas</h2>
      {!data ? (
        <p className="note">
          Aucun résultat. Lancez <code>npm run bench:aqueduc</code> contre <code>next start</code>.
        </p>
      ) : (
        <AqueducResults rows={data.rows} meta={data.meta} />
      )}
    </section>
  );
}

function AqueducResults({ rows, meta }: { rows: AqueducRow[]; meta: Record<string, unknown> | null }) {
  const main = rows.filter((r) => r.underground === "false");
  const under = rows.filter((r) => r.underground === "true");
  const tags = [...new Set(main.map((r) => r.tags))].sort((a, b) => a - b);
  const reps = Math.max(1, ...rows.map((r) => r.rep));
  const get = (phase: string, metric: string) => (n: number | string, mode: string) => num(main.find((r) => r.tags === Number(n) && r.mode === mode && r.phase === phase)?.[metric]);
  const phases = meta?.phases as Record<string, { planned: string; meanMs: number }> | undefined;
  const vp = meta?.viewport as { width: number; height: number } | undefined;
  const onScreen = meta?.tagsOnScreen as Record<string, number> | undefined;
  return (
    <>
      <p className="lead">
        Démo <Link href="/">réseau d&apos;eau</Link> (Trois-Rivières, données simulées) : mêmes étiquettes de capteurs en marqueurs DOM ou dessinées dans la scène 3D. Étiquettes
        forcées par le banc (capteurs réels de la zone, puis points de mesure supplémentaires <strong>simulés</strong>), sans le filtre de pertinence ni le plafond de 8 de
        l&apos;usage normal. Moyenne de {reps} répétition{reps > 1 ? "s" : ""}. <a href="/bench/aqueduc.csv">Télécharger le CSV</a>
      </p>
      {meta && (
        <p className="meta">
          {String(meta.browser)} · WebGL : {String(meta.webgl)} · GPU : {meta.gpu ? "oui" : "non"} · CPU : {String(meta.cpu)} · vue {vp?.width}×{vp?.height} ·{" "}
          {String(meta.date).slice(0, 16).replace("T", " ")}
          {phases && (
            <>
              {" "}
              · phases : {Object.entries(phases).map(([k, v]) => `${PHASES[k] ?? k} ${fmt(v.meanMs / 1000, 1)} s`).join(", ")}
            </>
          )}
        </p>
      )}
      {meta && !meta.gpu && (
        <p className="warn">
          Sans GPU (WebGL logiciel), chaque redessin de la carte coûte du CPU : pendant la rotation, qui redessine tout à chaque image, les deux modes tombent au même
          plancher ; immobile, l&apos;écart vient des captures des étiquettes (horloge ×60 : une nouvelle valeur par seconde). Le temps JS par image cache le message du
          flux (une fois par seconde) : il est mesuré à part, par mise à jour de données (p95 et maximum).
        </p>
      )}
      <Legend series={SERIES} />
      <div className="charts">
        <Bars title="FPS pendant la rotation" unit="images/s" groups={tags} groupLabel={(g) => `${g} étiq.`} series={SERIES} value={get("1-rotation", "fps")} note="plus haut = mieux" />
        <Bars title="Temps de frame p95, rotation" unit="ms" groups={tags} groupLabel={(g) => `${g} étiq.`} series={SERIES} value={get("1-rotation", "frameP95")} />
        <Bars title="JS par mise à jour, max (immobile ×60)" unit="ms" groups={tags} groupLabel={(g) => `${g} étiq.`} series={SERIES} value={get("2-immobile", "updMax")} note="flux, rendus, captures" />
        <Bars title="Captures par minute (immobile ×60)" unit="captures/min" groups={tags} groupLabel={(g) => `${g} étiq.`} series={SERIES} value={get("2-immobile", "capturesPerMin")} digits={0} note="0 en classique" />
        <Bars title="Latence lecture → pixel p50 * (immobile ×60)" unit="ms" groups={tags} groupLabel={(g) => `${g} étiq.`} series={SERIES} value={get("2-immobile", "latP50")} digits={0} />
        <Bars title="Latence lecture → pixel p95 * (immobile ×60)" unit="ms" groups={tags} groupLabel={(g) => `${g} étiq.`} series={SERIES} value={get("2-immobile", "latP95")} digits={0} note="cadence de 2 s incluse" />
      </div>
      <p className="note">
        Latence : de la réception SSE d&apos;une lecture à l&apos;image qui l&apos;affiche (classique : image suivant la mise à jour du marqueur ; HTML-in-Canvas : dessin
        suivant l&apos;upload de la texture de l&apos;étiquette), hors première capture, étiquettes à l&apos;écran seulement. Les étiquettes se mettent à jour au plus
        toutes les 2 s dans les deux modes. HTML-in-Canvas compte un échantillon par capture : une lecture remplacée avant sa capture n&apos;est pas comptée
        (regroupement), d&apos;où moins d&apos;échantillons qu&apos;en classique.
      </p>
      <p className="note">
        * Moyenne pondérée par le nombre d&apos;échantillons des répétitions qui en ont ; « — » : aucun échantillon. † Survol de 10 étiquettes visibles en
        HTML-in-Canvas, caméra immobile, après la phase 2 : rapporté sur la ligne « Immobile » seulement.
        {onScreen && (
          <>
            {" "}
            Étiquettes à l&apos;écran à la caméra de départ (les autres sont montées hors du cadre) :{" "}
            {tags.map((n) => `${n} → ${onScreen[`classic/${n}`] ?? "?"} en classique, ${onScreen[`hic/${n}`] ?? "?"} en HTML-in-Canvas`).join(" ; ")}.
          </>
        )}
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Étiquettes</th>
              <th scope="col">Phase</th>
              <th scope="col">Mode</th>
              {COLS.map(([, l]) => (
                <th key={l} scope="col">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {main
              .slice()
              .sort((a, b) => a.tags - b.tags || a.phase.localeCompare(b.phase) || a.mode.localeCompare(b.mode))
              .map((r) => (
                <Line key={`${r.tags}-${r.phase}-${r.mode}`} r={r} first={String(r.tags)} />
              ))}
          </tbody>
        </table>
      </div>
      {under.length > 0 && (
        <>
          <h3>Vue souterraine (HTML-in-Canvas, 60 étiquettes)</h3>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Tubes</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Mode</th>
                  {COLS.map(([, l]) => (
                    <th key={l} scope="col">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...main.filter((r) => r.mode === "hic" && r.tags === 60 && r.phase !== "3-scenario").map((r) => ({ ...r, tubes: "aucun (vue normale)" })), ...under]
                  .sort((a, b) => a.phase.localeCompare(b.phase))
                  .map((r) => (
                    <Line key={`${r.tubes}-${r.phase}`} r={r} first={r.tubes === "tout" ? "Tout le réseau" : r.tubes === "maitresses" ? "Maîtresses + zone suivie" : r.tubes} />
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Line({ r, first }: { r: AqueducRow; first: string }) {
  return (
    <tr>
      <th scope="row">{first}</th>
      <td>{PHASES[r.phase] ?? r.phase}</td>
      <td>{SERIES.find((s) => s.key === r.mode)?.label ?? r.mode}</td>
      {COLS.map(([k, , d]) => (
        <td key={k} className="num">
          {fmt(r[k], d)}
        </td>
      ))}
    </tr>
  );
}
