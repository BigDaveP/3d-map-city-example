import { CITIES, RESTAURANTS, type CityId } from "@/lib/carte/catalog";
import { restaurantAt } from "@/lib/carte/sim";
import { listRestaurantState } from "@/server/carte-repo";
import CarteShell from "./CarteShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Carte opérationnelle 3D — HTML-in-Canvas" };

const LABEL = { ouvert: "Ouvert", achalandé: "Achalandé", pause: "En pause" } as const;

/** Le SSR rend la liste des restaurants, leurs statuts et les alertes : lisible sans JavaScript. */
export default async function CartePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const mode = sp.mode === "classic" || sp.mode === "hic" ? sp.mode : undefined;
  const city = sp.ville === "qc" || sp.ville === "mtl" ? (sp.ville as CityId) : undefined;
  const state = await listRestaurantState().catch(() => ({}) as Awaited<ReturnType<typeof listRestaurantState>>);
  const now = Date.now();
  const rows = RESTAURANTS.map((r) => ({ r, live: restaurantAt(r.idx, now, !!state[r.id]?.paused, state[r.id]?.dispatched ?? 0) }));
  const alerts = rows.filter((x) => x.live.status !== "ouvert");
  return (
    <div className="app carte-app">
      <p className="sim-banner" role="note">
        ⚠️ Données entièrement simulées : restaurants, livreurs et commandes sont fictifs (positions dans des quartiers réels).
      </p>
      <aside className="overview" aria-labelledby="carte-title">
        <h1 id="carte-title">Carte opérationnelle</h1>
        <p className="note">Vue rendue côté serveur. {RESTAURANTS.length} restaurants, {alerts.length} en alerte.</p>
        <h2>Alertes</h2>
        <ul>
          {alerts.map(({ r, live }) => (
            <li key={r.id}>
              <strong>{r.name}</strong> ({CITIES[r.city].name}) — {LABEL[live.status]}, {live.pending} commandes
            </li>
          ))}
          {!alerts.length && <li>Aucune alerte.</li>}
        </ul>
        {(Object.keys(CITIES) as CityId[]).map((c) => (
          <section key={c}>
            <h2>{CITIES[c].name}</h2>
            <table>
              <thead>
                <tr>
                  <th scope="col">Restaurant</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Cmd</th>
                  <th scope="col">Prép.</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((x) => x.r.city === c)
                  .map(({ r, live }) => (
                    <tr key={r.id}>
                      <th scope="row">{r.name}</th>
                      <td className={live.status === "ouvert" ? "" : "crit"}>{LABEL[live.status]}</td>
                      <td className="num">{live.pending}</td>
                      <td className="num">{live.prepMin} min</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
      </aside>
      <main className="stage" aria-label="Carte interactive">
        <noscript>
          <p className="noscript">La carte 3D nécessite JavaScript et WebGL2. La liste ci-contre reste consultable.</p>
        </noscript>
        <CarteShell mode={mode} city={city} />
      </main>
    </div>
  );
}
