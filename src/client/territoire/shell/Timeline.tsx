"use client";
/**
 * Frise de 24 h commune à tous les environnements : journée simulée locale (de minuit à minuit,
 * 23 h ou 25 h au changement d'heure), heure simulée, vitesse ×1 / ×60, retour à « maintenant »,
 * repères des événements de la journée scénarisée (bulles au survol et au focus) et curseur
 * déplaçable (souris, tactile, clavier). Le module actif y ajoute sa courbe et sa légende
 * (`EnvModule.timeline`) et peut interpréter le curseur (scénario guidé de l'aqueduc).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { atHour, dayEndOf, dayEvents, dayStartOf } from "@/lib/territoire/day";
import { ENVS } from "@/lib/territoire/envs";
import { clockDay, clockTime } from "../../aqueduc/format";
import type { TimelineParts, TimelineTrack } from "../modules/types";
import { backToNow, seek, setSpeed, simNow } from "../store";
import { useSimNow, useTerritoire } from "../useTerritoire";

const KEY_STEP = 15 * 60_000;
const MINUTE = 60_000;
const HOURS = ["00:00", "06:00", "12:00", "18:00"];

/** Partie commune quand le module n'a pas de courbe : la journée simulée elle-même. */
const PLAIN: TimelineParts = {
  driven: null,
  caption: (
    <>
      <span className="aq-tl-title">Journée simulée</span>
      <span className="aq-tl-sub">Heure locale de Trois-Rivières</span>
    </>
  ),
  curve: null,
};

export function Timeline({ track }: { track: TimelineTrack | null }) {
  const now = useSimNow();
  const speed = useTerritoire((s) => s.clock.speed);
  const day = dayStartOf(now);
  const dayEnd = dayEndOf(now);
  const len = dayEnd - day;
  const events = useMemo(() => dayEvents(day), [day]);
  const plot = useRef<HTMLDivElement>(null);
  // position en cours de glissement ou de réglage au clavier (validée au relâchement)
  const [preview, setPreview] = useState<number | null>(null);
  const commit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(commit.current), []);
  const go = (t: number) => (track?.seek ?? seek)(t);

  const cursor = preview ?? now;
  const pct = (t: number) => `${Math.min(1, Math.max(0, (t - day) / len)) * 100}%`;
  const at = (clientX: number) => {
    const r = plot.current!.getBoundingClientRect();
    return day + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (len - MINUTE);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setPreview(at(e.clientX));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => preview !== null && setPreview(at(e.clientX));
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (preview === null) return;
    go(at(e.clientX));
    setPreview(null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const base = preview ?? simNow();
    const d = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP, PageDown: -4 * KEY_STEP, PageUp: 4 * KEY_STEP }[e.key];
    let next = d !== undefined ? base + d : e.key === "Home" ? day : e.key === "End" ? dayEnd - MINUTE : null;
    if (next === null) return;
    e.preventDefault();
    next = Math.min(dayEnd - MINUTE, Math.max(day, next));
    setPreview(next);
    // une seule reconnexion du flux après une rafale de touches
    clearTimeout(commit.current);
    commit.current = setTimeout(() => (go(next!), setPreview(null)), 400);
  };

  const render = (parts: TimelineParts): ReactNode => {
    // pas de « Maintenant » quand le module mène l'horloge (scénario guidé)
    const live = parts.driven !== null || (speed === 1 && Math.abs(now - Date.now()) < 120_000);
    return (
      <section className="aq-timeline aq-panel" aria-label="Frise de 24 heures">
        <div className="aq-tl-l">
          <span className="tr-clock" role="timer" aria-label={`Heure simulée ${clockTime(now)}${speed === 60 ? ", accélérée 60 fois" : ""}`}>
            <span className={parts.driven ? "tr-clock-driven" : "tr-clock-day"}>{parts.driven ?? clockDay(now)}</span>
            <b className="aq-num">{clockTime(now)}</b>
            {speed === 60 && <span className="tr-speed">×60</span>}
          </span>
          {parts.caption}
          <div className="aq-tl-btns">
            <div className="aq-seg" role="group" aria-label="Vitesse de l'horloge simulée">
              <button type="button" aria-pressed={speed === 1} onClick={() => setSpeed(1)}>
                ×1
              </button>
              <button type="button" aria-pressed={speed === 60} onClick={() => setSpeed(60)}>
                ×60
              </button>
            </div>
            {!live && (
              <button type="button" className="aq-btn" onClick={() => backToNow()}>
                Maintenant
              </button>
            )}
          </div>
        </div>
        <div className="aq-tl-r">
          <div className="aq-tl-plot" ref={plot} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setPreview(null)}>
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2="1000" y1="92" y2="92" className="aq-tl-grid" />
              <line x1="0" x2="1000" y1="52" y2="52" className="aq-tl-grid" />
            </svg>
            {parts.curve}
            <div className="aq-tl-hours" aria-hidden="true">
              {HOURS.map((h) => (
                <span key={h} style={{ left: pct(atHour(day, h)) }}>
                  {Number(h.slice(0, 2))} h
                </span>
              ))}
              <span style={{ left: "100%" }}>24 h</span>
            </div>
            <ol className="tr-tl-ticks" aria-label="Événements de la journée (simulation)">
              {events.map((e) => (
                <li
                  key={e.time}
                  style={{ left: pct(e.at) }}
                  data-env={e.env}
                  data-past={e.at <= now || undefined}
                  // bulle alignée sur le bord près des extrémités (la frise la rognerait)
                  data-align={(e.at - day) / len < 0.15 ? "start" : (e.at - day) / len > 0.85 ? "end" : undefined}
                >
                  <button
                    type="button"
                    aria-label={`${e.label} : ${ENVS[e.env].title}, aller à ${e.time}`}
                    // le clic choisit l'heure du repère, pas celle sous le pointeur
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => go(e.at)}
                  />
                  <span className="tr-tip" role="tooltip">
                    <b className="aq-num">{e.time}</b> {e.label.replace(/ \([^)]*\)$/, "")}
                    <em>{ENVS[e.env].title}</em>
                  </span>
                </li>
              ))}
            </ol>
            <div
              className="aq-tl-cursor"
              style={{ left: pct(cursor) }}
              // étiquette à gauche du curseur près de minuit (la frise la rognerait)
              data-align={(cursor - day) / len > 0.92 ? "end" : undefined}
              role="slider"
              tabIndex={0}
              aria-label="Heure simulée"
              aria-valuemin={0}
              aria-valuemax={Math.round(len / MINUTE) - 1}
              aria-valuenow={Math.round((cursor - day) / MINUTE)}
              aria-valuetext={clockTime(cursor)}
              onKeyDown={key}
            >
              <span className="aq-num">{clockTime(cursor)}</span>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const Track = track?.Track;
  return Track ? (
    <Track day={day} dayEnd={dayEnd} now={now}>
      {render}
    </Track>
  ) : (
    render(PLAIN)
  );
}
