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
import { EnvIcon } from "../shell/EnvIcon";
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
            <SevIcon severity={s} size={15} />
            <b>{summary[s]}</b>
            <span>{NAME[s][summary[s] > 1 ? 1 : 0]}</span>
          </li>
        ))}
      </ul>
      {alerts.length === 0 ? (
        <p className="tr-alerts-empty">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15ZM6.8 10.2l2.2 2.2 4.2-4.6" />
          </svg>
          Aucune alerte active à cette heure de la journée simulée.
        </p>
      ) : (
        <ul className="tr-alert-list">
          {alerts.map((a) => (
            <li key={a.id} className="tr-alert" data-sev={a.severity}>
              <SevIcon severity={a.severity} size={18} />
              <div className="tr-alert-b">
                <p className="tr-alert-t">
                  <span className="aq-sr">{NAME[a.severity][0]} : </span>
                  {a.title}
                </p>
                <p className="tr-alert-d">{a.detail}</p>
                <p className="tr-alert-m">
                  <EnvIcon env={a.env} size={13} />
                  {ENVS[a.env].title} · depuis {a.time}
                </p>
              </div>
              <Link className="tr-open" href={a.href} onNavigate={() => setFocus(alertFocus(a))}>
                Ouvrir<span className="aq-sr"> : {a.title}</span>
                <span aria-hidden="true"> →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
