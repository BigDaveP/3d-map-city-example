import { normalizeCardCount } from "@/lib/sim/types";
import { getOverview } from "@/server/overview";
import WallShell from "./WallShell";

export const dynamic = "force-dynamic";

/**
 * Le SSR ne rend que la vue d'ensemble, en HTML sémantique lisible sans JavaScript.
 * Le mur (canvas, WebGL, cartes) est monté côté client après l'hydratation.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const n = normalizeCardCount(sp.n ?? 1000);
  const mode = sp.mode === "dom" || sp.mode === "canvas" ? sp.mode : undefined;
  const o = await getOverview(n);
  return (
    <div className="app">
      <p className="sim-banner" role="note">
        ⚠️ Données entièrement simulées : succursales, chiffres, avis et responsables sont fictifs.
      </p>
      <aside className="overview" aria-labelledby="ov-title">
        <h1 id="ov-title">Mur de supervision</h1>
        <p className="note">
          Vue d&apos;ensemble rendue côté serveur (état initial). {o.totals.cards} cartes, <span className="crit">{o.totals.critical} critiques</span>, {o.totals.attention} en
          attention.
        </p>
        <h2>Régions</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Région</th>
              <th scope="col">Succ.</th>
              <th scope="col">Critiques</th>
              <th scope="col">Attention</th>
            </tr>
          </thead>
          <tbody>
            {o.regions.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.name}</th>
                <td className="num">{r.branches}</td>
                <td className="num crit">{r.critical}</td>
                <td className="num">{r.attention}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Alertes manuelles ({o.manual.length})</h2>
        {o.manual.length ? (
          <ul>
            {o.manual.map((a) => (
              <li key={a.id}>
                <strong>{a.branchName}</strong> — {a.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">Aucune alerte manuelle.</p>
        )}
        <h2>Indicateurs critiques ({o.autoTotal})</h2>
        <ul>
          {o.auto.map((a, i) => (
            <li key={i}>
              {a.branch} — {a.label}
            </li>
          ))}
          {o.autoTotal > o.auto.length && <li>… et {o.autoTotal - o.auto.length} autres</li>}
        </ul>
      </aside>
      <main className="stage" aria-label="Mur interactif">
        <noscript>
          <p className="noscript">Le mur interactif nécessite JavaScript. La vue d&apos;ensemble ci-contre reste consultable.</p>
        </noscript>
        <WallShell n={n} mode={mode} />
      </main>
    </div>
  );
}
