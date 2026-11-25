"use client";
/**
 * Cloche des alertes de la barre (référence Shopify) : le nombre d'alertes actives, coloré par la
 * plus grave, et un menu déroulant avec la liste. Choisir une alerte mène à son environnement
 * (navigation côté client, la carte reste si on y est déjà) et y met en avant l'objet en cause
 * (`focus`, lu par le module de l'environnement, qui le sélectionne, y amène la caméra puis l'efface).
 *
 * Accessibilité : bouton avec `aria-expanded` et `aria-controls`, fenêtre `role="dialog"` titrée ;
 * à l'ouverture, le focus va à la première alerte ; flèches haut / bas, Début / Fin entre les
 * alertes ; Échap referme et rend le focus au bouton ; sortir au clavier (Tab) ou cliquer à
 * l'extérieur referme.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { Severity } from "@/lib/territoire/alerts";
import { ENVS, type EnvId } from "@/lib/territoire/envs";
import { alertFocus, severityCount, type HomeAlert } from "@/lib/territoire/home";
import { setFocus } from "../store";
import { EnvIcon, UiIcon } from "./EnvIcon";

const ORDER: Severity[] = ["critique", "attention", "info"];

/** Pictogramme d'une gravité (forme en plus de la couleur). */
export function SevIcon({ severity, size = 16 }: { severity: Severity; size?: number }) {
  const d =
    severity === "critique" ? "M10 2.5 18 17H2L10 2.5Z M10 8v4 M10 14.6v.1"
    : severity === "attention" ? "M10 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z M10 6.5v4.5 M10 13.6v.1"
    : "M10 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z M10 9v4.5 M10 6.4v.1";
  return (
    <svg className="tr-sev-i" data-sev={severity} width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** « 2 alertes actives : 1 critique, 1 à surveiller » (nom accessible du bouton). */
function bellLabel(alerts: readonly HomeAlert[]): string {
  if (alerts.length === 0) return "Alertes : aucune alerte active";
  const parts = ORDER.map((s) => [s, alerts.filter((a) => a.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => severityCount(s, n));
  return `Alertes : ${alerts.length} ${alerts.length > 1 ? "actives" : "active"} (${parts.join(", ")})`;
}

/** Clic ordinaire (pas un nouvel onglet ni une nouvelle fenêtre). */
const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function AlertBell({ alerts, current }: { alerts: readonly HomeAlert[]; current: EnvId | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLAnchorElement | null)[]>([]);
  const id = useId();
  const top = alerts.length > 0 ? alerts[0].severity : null;

  // ouverture : focus sur la première alerte (ou la fenêtre si elle est vide) ; clic extérieur : fermeture
  useEffect(() => {
    if (!open) return;
    (items.current[0] ?? document.getElementById(`${id}-pop`))?.focus();
    const out = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, [open, id]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) opener.current?.focus();
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return close(true);
    }
    const list = items.current.filter((x): x is HTMLAnchorElement => x !== null);
    const i = list.findIndex((x) => x === document.activeElement);
    const n = list.length;
    const next = { ArrowDown: i + 1, ArrowUp: i < 0 ? n - 1 : i - 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined || n === 0) return;
    e.preventDefault();
    list[(next + n) % n]?.focus();
  };
  // le focus quitte le menu (Tab, clic ailleurs) : on referme sans le reprendre
  const blur = (e: FocusEvent<HTMLDivElement>) => {
    if (open && e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false);
  };

  /** Alerte de l'environnement affiché : pas de navigation, seulement la mise en avant. */
  const choose = (a: HomeAlert) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (a.env !== current || !plainClick(e)) return;
    e.preventDefault();
    setFocus(alertFocus(a));
    close(true);
  };

  const summary = ORDER.map((s) => [s, alerts.filter((a) => a.severity === s).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="tr-bell" ref={box} onKeyDown={key} onBlur={blur}>
      <button
        ref={opener}
        type="button"
        className="tr-bell-btn tr-iconbtn"
        data-sev={top ?? undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-pop`}
        aria-label={bellLabel(alerts)}
        title="Alertes"
        onClick={() => setOpen(!open)}
      >
        <UiIcon name="bell" size={18} />
        {alerts.length > 0 && (
          <span className="tr-bell-count" aria-hidden="true">
            {alerts.length}
          </span>
        )}
      </button>
      {open && (
        <div id={`${id}-pop`} className="tr-bell-pop" role="dialog" aria-labelledby={`${id}-h`} tabIndex={-1}>
          <div className="tr-bell-h">
            <h2 id={`${id}-h`}>Alertes</h2>
            <span className="tr-sim">Simulation</span>
          </div>
          {summary.length > 0 && (
            <p className="tr-bell-sum">
              {summary.map(([s, n]) => (
                <span key={s} className="tr-sev-chip" data-sev={s}>
                  <SevIcon severity={s} size={16} />
                  {severityCount(s, n)}
                </span>
              ))}
            </p>
          )}
          {alerts.length === 0 ? (
            <p className="tr-bell-empty">Aucune alerte active à cette heure de la journée simulée.</p>
          ) : (
            <ul className="tr-bell-list">
              {alerts.map((a, i) => (
                <li key={a.id}>
                  <Link
                    ref={(el) => void (items.current[i] = el)}
                    href={a.href}
                    className="tr-bell-item"
                    data-sev={a.severity}
                    scroll={false}
                    onClick={choose(a)}
                    onNavigate={() => {
                      setFocus(alertFocus(a));
                      setOpen(false);
                    }}
                  >
                    <SevIcon severity={a.severity} />
                    <span className="tr-bell-t">
                      <b>{a.title}</b>
                      <span className="tr-bell-d">{a.detail}</span>
                      <span className="tr-bell-m">
                        <EnvIcon env={a.env} size={16} />
                        {ENVS[a.env].title} · {a.time}
                        {a.env !== current && <span className="tr-bell-go"> · Ouvrir</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {current !== null && (
            <p className="tr-bell-f">
              <Link href="/" onNavigate={() => setOpen(false)}>
                Vue d&apos;ensemble de la ville
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
