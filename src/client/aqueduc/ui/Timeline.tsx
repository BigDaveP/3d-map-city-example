"use client";
/**
 * Frise de 24 h : courbe du réseau, du secteur ou de l'élément sélectionné pour la journée simulée,
 * évènements, curseur déplaçable (souris, tactile, clavier) et vitesse ×1 / ×60. Pendant le scénario,
 * la frise suit sa ligne de temps : l'heure visée choisit l'étape (`seekTo`).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CITY } from "@/lib/aqueduc/city";
import { SCENARIO_DAY, scenarioSteps } from "@/lib/aqueduc/scenario";
import { clockTime, dayStart, num } from "../format";
import { seekTo } from "../scenarioController";
import { backToNow, incidentQuery, selectionKey, setSpeed, simNow } from "../store";
import { useAq, useSimNow } from "../useAq";

const DAY = 86_400_000;
const SCENARIO_STEPS = scenarioSteps(SCENARIO_DAY);
const KEY_STEP = 15 * 60_000;

interface Series {
  label: string;
  unit: string;
  from: number;
  step: number;
  values: number[];
}

/**
 * Courbe de la journée, recalculée quand la sélection, le jour ou l'incident changent ; pendant le
 * scénario, sans sélection, la pression du tronçon brisé (la chute de 06:57 se lit sur la frise).
 */
function useSeries(day: number): Series | null {
  const sel = useAq((s) => selectionKey(s.selection ?? (s.scenario.active ? { kind: "segment", id: CITY.breakSegment } : null)));
  const inc = useAq((s) => incidentQuery(s.incident));
  const [series, setSeries] = useState<Series | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const q = `t=${day + DAY / 2}${sel ? `&sel=${encodeURIComponent(sel)}` : ""}${inc ? `&${inc}` : ""}`;
    fetch(`/api/aqueduc/series?${q}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Series | null) => setSeries(j))
      .catch(() => {});
    return () => ac.abort();
  }, [day, sel, inc]);
  return series;
}

const H = 100;
/** Chemin SVG des valeurs [i0, i1) dans un repère 1000 × 100. */
function path(s: Series, lo: number, hi: number, i0: number, i1: number) {
  const pts: string[] = [];
  for (let i = Math.max(0, i0); i < Math.min(s.values.length, i1); i++) {
    const x = ((s.step * i) / DAY) * 1000;
    const y = H - 8 - ((s.values[i] - lo) / (hi - lo || 1)) * (H - 22);
    pts.push(`${pts.length ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

export function Timeline() {
  const now = useSimNow();
  const speed = useAq((s) => s.clock.speed);
  const incident = useAq((s) => s.incident);
  const scenario = useAq((s) => (s.scenario.active ? s.scenario.step : null));
  const day = dayStart(now);
  const series = useSeries(day);
  const plot = useRef<HTMLDivElement>(null);
  // position en cours de glissement ou de réglage au clavier (validée au relâchement)
  const [preview, setPreview] = useState<number | null>(null);
  const commit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(commit.current), []);

  const cursor = preview ?? now;
  const frac = Math.min(1, Math.max(0, (cursor - day) / DAY));
  const at = (clientX: number) => {
    const r = plot.current!.getBoundingClientRect();
    return day + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (DAY - 60_000);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setPreview(at(e.clientX));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => preview !== null && setPreview(at(e.clientX));
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (preview === null) return;
    seekTo(at(e.clientX));
    setPreview(null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const base = preview ?? simNow();
    const d = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP, PageDown: -4 * KEY_STEP, PageUp: 4 * KEY_STEP }[e.key];
    let next = d !== undefined ? base + d : e.key === "Home" ? day : e.key === "End" ? day + DAY - 60_000 : null;
    if (next === null) return;
    e.preventDefault();
    next = Math.min(day + DAY - 60_000, Math.max(day, next));
    setPreview(next);
    // une seule reconnexion du flux après une rafale de touches
    clearTimeout(commit.current);
    commit.current = setTimeout(() => (seekTo(next!), setPreview(null)), 400);
  };

  // « Maintenant » n'a pas de sens pendant le scénario, qui a sa propre ligne de temps
  const live = scenario !== null || (speed === 1 && Math.abs(now - Date.now()) < 120_000);
  const k = scenario ? SCENARIO_STEPS.findIndex((x) => x.id === scenario) : -1;
  let lo = 0;
  let hi = 1;
  if (series) {
    lo = Math.min(...series.values);
    hi = Math.max(...series.values);
    const pad = (hi - lo) * 0.12 || 1;
    lo = Math.max(0, lo - pad);
    hi += pad;
  }
  const nowIdx = series ? Math.floor((now - series.from) / series.step) + 1 : 0;
  const current = series?.values[Math.min(series.values.length - 1, Math.max(0, nowIdx - 1))];
  const events = incident
    ? [
        { t: incident.startedAt, label: "Bris", tone: "bad" },
        ...(incident.restoredAt !== null ? [{ t: incident.restoredAt, label: "Remise en eau", tone: "good" }] : []),
      ].filter((e) => e.t >= day && e.t < day + DAY)
    : [];

  return (
    <section className="aq-timeline aq-panel" aria-label="Frise de 24 heures">
      <div className="aq-tl-l">
        {scenario && (
          <span className="aq-tl-scenario">
            Scénario · étape {k + 1} sur {SCENARIO_STEPS.length}
          </span>
        )}
        <span className="aq-tl-title">{series?.label ?? "Chargement de la courbe…"}</span>
        <span className="aq-tl-sub">
          {current !== undefined && series ? (
            <>
              <b className="aq-num">
                {num(current, current < 10 ? 2 : 0)} {series.unit}
              </b>{" "}
              à {clockTime(now)} · simulé
            </>
          ) : (
            "Simulation"
          )}
        </span>
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
        <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="1000" y1={H - 8} y2={H - 8} className="aq-tl-grid" />
          <line x1="0" x2="1000" y1={(H - 8) / 2 + 6} y2={(H - 8) / 2 + 6} className="aq-tl-grid" />
          {series && (
            <>
              <path d={path(series, lo, hi, 0, nowIdx + 1)} className="aq-tl-past" vectorEffect="non-scaling-stroke" />
              <path d={path(series, lo, hi, nowIdx, series.values.length)} className="aq-tl-future" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        <div className="aq-tl-hours" aria-hidden="true">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
              {String(h).padStart(2, "0")} h
            </span>
          ))}
        </div>
        {events.map((e) => (
          <div key={e.label} className={`aq-tl-event aq-${e.tone}`} style={{ left: `${((e.t - day) / DAY) * 100}%` }}>
            <span>
              {clockTime(e.t)} {e.label}
            </span>
          </div>
        ))}
        <div
          className="aq-tl-cursor"
          style={{ left: `${frac * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Heure simulée"
          aria-valuemin={0}
          aria-valuemax={1439}
          aria-valuenow={Math.round((cursor - day) / 60_000)}
          aria-valuetext={clockTime(cursor)}
          onKeyDown={key}
        >
          <span className="aq-num">{clockTime(cursor)}</span>
        </div>
        </div>
      </div>
    </section>
  );
}
