"use client";
/**
 * Alertes de l'accueil (référence Searchable) : résumé par gravité, puis la liste, la plus grave et
 * la plus récente d'abord. « Ouvrir » mène à l'environnement de l'alerte et y met en avant l'objet
 * en cause (`focus`, posé seulement pour cet environnement, au moment de la navigation côté client).
 * Sans JavaScript, « Ouvrir » reste un lien ordinaire vers la vue de l'environnement.
 */
import Link from "next/link";
import type { Severity } from "@/lib/territoire/alerts";
import { ENVS } from "@/lib/territoire/envs";
import { alertFocus, type HomeAlert } from "@/lib/territoire/home";
import { SevIcon } from "../shell/AlertBell";
import { EnvIcon, UiIcon } from "../shell/EnvIcon";
import { setFocus } from "../store";

const ORDER: Severity[] = ["critique", "attention", "info"];
const NAME: Record<Severity, [string, string]> = {
  critique: ["critique", "critiques"],
  attention: ["à surveiller", "à surveiller"],
  info: ["info", "info"],
};

export function AlertsPanel({ alerts, summary }: { alerts: readonly HomeAlert[]; summary: Record<Severity, number> }) {
  return (
    <section className="tr-card tr-alerts" id="alertes" aria-labelledby="tr-alerts-h">
      <div className="tr-card-h">
        <h2 id="tr-alerts-h">Alertes actives</h2>
        <span className="tr-sim">Simulation</span>
      </div>
      <ul className="tr-sevsum" aria-label="Alertes par gravité">
        {ORDER.map((s) => (
          <li key={s} data-sev={s} data-zero={summary[s] === 0 || undefined}>
            <b>{summary[s]}</b>
            <span className="tr-sevsum-l">
              <SevIcon severity={s} size={16} />
              {NAME[s][summary[s] > 1 ? 1 : 0]}
            </span>
          </li>
        ))}
      </ul>
      {alerts.length === 0 ? (
        <p className="tr-alerts-empty">
          <UiIcon name="check" />
          Aucune alerte active à cette heure de la journée simulée
        </p>
      ) : (
        <ul className="tr-alert-list">
          {alerts.map((a) => (
            <li key={a.id} className="tr-alert" data-sev={a.severity}>
              <SevIcon severity={a.severity} size={16} />
              <div className="tr-alert-b">
                <p className="tr-alert-t">
                  <span className="aq-sr">{NAME[a.severity][0]} : </span>
                  {a.title}
                </p>
                <p className="tr-alert-d">{a.detail}</p>
                <p className="tr-alert-m">
                  <EnvIcon env={a.env} size={16} />
                  {ENVS[a.env].title} · depuis {a.time}
                </p>
              </div>
              <Link className="tr-open" href={a.href} onNavigate={() => setFocus(alertFocus(a))}>
                Ouvrir<span className="aq-sr"> : {a.title}</span>
                <UiIcon name="chevron-right" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
