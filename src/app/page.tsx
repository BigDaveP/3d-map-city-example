import type { Metadata, Viewport } from "next";
import { clockDay, clockTime, num, sectorStatus, NIGHT_RATIO_WARN } from "@/client/aqueduc/format";
import DemoNav from "@/client/shell/DemoNav";
import { CITY } from "@/lib/aqueduc/city";
import { readingsAt, sectorStats } from "@/lib/aqueduc/sim";
import { getModel } from "@/server/aqueduc";
import AqueducShell from "./AqueducShell";

export const metadata: Metadata = {
  title: "Réseau d'eau potable · Trois-Rivières",
  description:
    "Démo HTML-in-Canvas : le réseau d'aqueduc réel de Trois-Rivières en 3D, avec capteurs, secteurs et scénario de bris simulés.",
};
export const viewport: Viewport = { themeColor: "#ffffff" };

const TONE = ["good", "warn", "bad"] as const;

/**
 * Vue rendue par le serveur, lisible sans JavaScript : état du réseau à l'heure actuelle, secteurs et
 * leur statut, attribution. L'application (carte 3D) la remplace une fois montée.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const mode = sp.mode === "classic" || sp.mode === "hic" ? sp.mode : undefined;
  const m = getModel();
  const t = Date.now();
  const stats = sectorStats(m, t, null);
  const readings = readingsAt(m, t, null);
  const alerts = new Map<string, number>();
  m.sensors.forEach((s, i) => readings[i].status === "alerte" && alerts.set(s.sector, (alerts.get(s.sector) ?? 0) + 1));
  const total = m.sectors.reduce((a, s) => a + s.addresses, 0);
  const served = stats.reduce((a, s) => a + s.served, 0);
  const sensorAlerts = readings.filter((r) => r.status === "alerte").length;
  const leaks = stats.filter((s) => s.nightRatio >= NIGHT_RATIO_WARN);
  const name = (id: string) => m.sectors.find((s) => s.id === id)!.name;

  return (
    <div className="aq-page">
      <header className="aq-bar aq-ssr-bar">
        <DemoNav current="aqueduc" />
        <span className="aq-brand">
          <i aria-hidden="true" />
          <span>
            Réseau d&apos;eau potable <span className="aq-city">· Trois-Rivières</span>
          </span>
        </span>
        <span className="aq-sim">Simulation</span>
      </header>
      <main className="aq-ssr" aria-labelledby="aq-title">
        <h1 id="aq-title">Réseau d&apos;eau potable de Trois-Rivières</h1>
        <p className="aq-lede">
          Le tracé réel des {num(m.network.segments.length)} tronçons de conduites de la Ville, avec des capteurs, des secteurs et des
          incidents simulés. <strong>Simulation</strong> : aucune mesure affichée ici ne vient d&apos;un vrai capteur.
        </p>
        <section aria-labelledby="aq-state">
          <h2 id="aq-state">
            État du réseau · {clockDay(t)}, {clockTime(t)}
          </h2>
          <dl className="aq-kv">
            <div>
              <dt>Adresses desservies (estimation)</dt>
              <dd className="aq-num">
                {num(served)} sur {num(total)}
              </dd>
            </div>
            <div>
              <dt>Incident en cours</dt>
              <dd>Aucun bris en cours</dd>
            </div>
            <div>
              <dt>Points d&apos;attention</dt>
              <dd className={leaks.length ? "aq-warn" : undefined}>
                {leaks.length
                  ? leaks.map((s) => `Débit de nuit élevé à ${name(s.id)} (+${num((s.nightRatio - 1) * 100)} %, fuite possible)`).join(" ; ")
                  : "Aucun"}
              </dd>
            </div>
            <div>
              <dt>Capteurs simulés</dt>
              <dd className="aq-num">
                {m.sensors.length}, dont {sensorAlerts} en alerte
              </dd>
            </div>
          </dl>
        </section>
        <section aria-labelledby="aq-sectors">
          <h2 id="aq-sectors">Secteurs de distribution (simulés)</h2>
          <table className="aq-table">
            <thead>
              <tr>
                <th scope="col">Secteur</th>
                <th scope="col" className="aq-r">
                  Adresses
                </th>
                <th scope="col" className="aq-r">
                  Débit
                </th>
                <th scope="col">Statut</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const st = sectorStatus(s, alerts.get(s.id) ?? 0);
                return (
                  <tr key={s.id}>
                    <th scope="row">{name(s.id)}</th>
                    <td className="aq-num">{num(s.served)}</td>
                    <td className="aq-num">{num(s.flowLs)} L/s</td>
                    <td className={`aq-${TONE[st.level]}`}>{st.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <p className="aq-attrib">{CITY.attribution}. Capteurs, mesures, secteurs, adresses et incidents : simulation.</p>
        <noscript>
          <p className="aq-note">La carte 3D interactive demande JavaScript et WebGL2. Ce résumé reste consultable sans eux.</p>
        </noscript>
      </main>
      <AqueducShell mode={mode} />
    </div>
  );
}
