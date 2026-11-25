import { clockDay, clockTime, num, sectorStatus, NIGHT_RATIO_WARN } from "@/client/aqueduc/format";
import { CITY } from "@/lib/aqueduc/city";
import { isolate } from "@/lib/aqueduc/graph";
import { dayIncident } from "@/lib/aqueduc/scenario";
import { readingsAt, sectorStats } from "@/lib/aqueduc/sim";
import { getModel } from "@/server/aqueduc";

const TONE = ["good", "warn", "bad"] as const;

/**
 * Résumé de l'aqueduc rendu par le serveur, lisible sans JavaScript : état du réseau à l'heure
 * actuelle de la journée scénarisée (bris de 14:00 compris, décisions par défaut), secteurs et leur
 * statut, attribution. La scène 3D le recouvre une fois montée.
 */
export function AqueducSummary() {
  const m = getModel();
  const t = Date.now();
  const seg = m.network.byId.get(CITY.breakSegment)!;
  const day = dayIncident(t, null, isolate(m.network, seg, m.valves).valves);
  const incident = day ? { segment: seg, ...day } : null;
  const stats = sectorStats(m, t, incident);
  const readings = readingsAt(m, t, incident);
  const alerts = new Map<string, number>();
  m.sensors.forEach((s, i) => readings[i].status === "alerte" && alerts.set(s.sector, (alerts.get(s.sector) ?? 0) + 1));
  const total = m.sectors.reduce((a, s) => a + s.addresses, 0);
  const served = stats.reduce((a, s) => a + s.served, 0);
  const sensorAlerts = readings.filter((r) => r.status === "alerte").length;
  const leaks = stats.filter((s) => s.nightRatio >= NIGHT_RATIO_WARN);
  const name = (id: string) => m.sectors.find((s) => s.id === id)!.name;
  const brk = `Bris de la conduite ${CITY.breakSegment} à ${clockTime(day?.startedAt ?? t)} (simulé)`;
  const now =
    !day ? "Aucun bris en cours"
    : day.restoredAt !== null && t >= day.restoredAt ? `${brk}, réparé : eau rétablie à ${clockTime(day.restoredAt)}`
    : day.closedValves.length ? `${brk} : tronçon isolé, réparation en cours`
    : `${brk} : tronçon non isolé`;

  return (
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
            <dd className={day && !(day.restoredAt !== null && t >= day.restoredAt) ? "aq-bad" : undefined}>{now}</dd>
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
  );
}
