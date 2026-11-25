"use client";
/**
 * Part de l'aqueduc dans la frise commune : courbe du réseau, du secteur ou de l'élément sélectionné
 * pour la journée simulée, son chiffre à l'heure affichée, et les heures du bris et de la remise en
 * eau. Pendant le scénario, la frise montre l'étape (le curseur choisit l'étape : `seekTo`).
 */
import { useEffect, useMemo, useState } from "react";
import { CITY } from "@/lib/aqueduc/city";
import { scenarioSteps } from "@/lib/aqueduc/scenario";
import { atHour } from "@/lib/territoire/day";
import type { TimelineTrack } from "../../territoire/modules/types";
import { clockTime, num } from "../format";
import { seekTo } from "../scenarioController";
import { incidentQuery, selectionKey } from "../store";
import { useAq } from "../useAq";

interface Series {
  label: string;
  unit: string;
  from: number;
  step: number;
  values: number[];
}

/**
 * Courbe de la journée, recalculée quand la sélection, le jour ou l'incident changent ; pendant le
 * scénario, sans sélection, la pression du tronçon brisé (la chute de 14:00 se lit sur la frise).
 */
function useSeries(day: number): Series | null {
  const sel = useAq((s) => selectionKey(s.selection ?? (s.scenario.active ? { kind: "segment", id: CITY.breakSegment } : null)));
  const inc = useAq((s) => incidentQuery(s.incident));
  const [series, setSeries] = useState<Series | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const q = `t=${atHour(day, "12:00")}${sel ? `&sel=${encodeURIComponent(sel)}` : ""}${inc ? `&${inc}` : ""}`;
    fetch(`/api/aqueduc/series?${q}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Series | null) => setSeries(j))
      .catch(() => {});
    return () => ac.abort();
  }, [day, sel, inc]);
  return series;
}

const H = 100;
/** Chemin SVG des valeurs [i0, i1) dans un repère 1000 × 100 qui couvre la journée [day, dayEnd). */
function path(s: Series, lo: number, hi: number, i0: number, i1: number, day: number, len: number) {
  const pts: string[] = [];
  for (let i = Math.max(0, i0); i < Math.min(s.values.length, i1); i++) {
    const x = ((s.from + s.step * i - day) / len) * 1000;
    const y = H - 8 - ((s.values[i] - lo) / (hi - lo || 1)) * (H - 22);
    pts.push(`${pts.length ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

const Track: TimelineTrack["Track"] = ({ day, dayEnd, now, children }) => {
  const len = dayEnd - day;
  const series = useSeries(day);
  const incident = useAq((s) => s.incident);
  const scenario = useAq((s) => (s.scenario.active ? s.scenario.step : null));
  const steps = useMemo(() => scenarioSteps(day), [day]);
  const k = scenario ? steps.findIndex((x) => x.id === scenario) : -1;
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
  // heures déjà passées seulement : la remise en eau n'apparaît qu'à l'étape du rétablissement
  const events = incident
    ? [
        { t: incident.startedAt, label: "Bris", tone: "bad" },
        ...(incident.restoredAt !== null ? [{ t: incident.restoredAt, label: "Remise en eau", tone: "good" }] : []),
      ].filter((e) => e.t >= day && e.t < dayEnd && e.t <= now)
    : [];
  return children({
    driven: scenario ? `Scénario · étape ${k + 1} sur ${steps.length}` : null,
    caption: (
      <>
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
      </>
    ),
    curve: (
      <>
        {series && (
          <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={path(series, lo, hi, 0, nowIdx + 1, day, len)} className="aq-tl-past" vectorEffect="non-scaling-stroke" />
            <path d={path(series, lo, hi, nowIdx, series.values.length, day, len)} className="aq-tl-future" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {events.map((e) => (
          <div key={e.label} className={`aq-tl-event aq-${e.tone}`} style={{ left: `${((e.t - day) / len) * 100}%` }}>
            <span>
              {clockTime(e.t)} {e.label}
            </span>
          </div>
        ))}
      </>
    ),
  });
};

/** Frise de l'aqueduc : courbe, chiffre et heures de l'incident ; curseur qui choisit l'étape pendant le scénario. */
export const aqueducTimeline: TimelineTrack = { Track, seek: (t) => seekTo(t) };
