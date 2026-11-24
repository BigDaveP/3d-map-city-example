"use client";
/** Puce de performance (images/s, temps JS p95) ; un clic ouvre le détail des mesures de `/carte`. */
import { useEffect, useRef, useState } from "react";
import { CarteMetrics } from "../../carte/CarteMetrics";
import type { Metrics } from "../../metrics";
import { num } from "../format";
import { useAq } from "../useAq";

export function PerfChip({ metrics }: { metrics: Metrics | null }) {
  const [snap, setSnap] = useState({ fps: 0, work: 0 });
  const [open, setOpen] = useState(false);
  const mode = useAq((s) => s.mode);
  const sensors = useAq((s) => s.live.readings.length);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!metrics) return;
    const id = setInterval(() => {
      const s = metrics.snapshot();
      setSnap({ fps: s.fps, work: s.workP95 });
    }, 1000);
    return () => clearInterval(id);
  }, [metrics]);
  // fermeture : Échap ou clic à l'extérieur
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const out = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", out);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", out);
    };
  }, [open]);
  return (
    <div className="aq-perf" ref={box}>
      <button type="button" className="aq-chip" aria-expanded={open} aria-controls="aq-perf-detail" onClick={() => setOpen(!open)} title="Mesures de performance">
        <b className="aq-num">{num(snap.fps)} i/s</b>
        <span aria-hidden="true"> · </span>JS <span className="aq-num">{num(snap.work, 1)} ms</span>
      </button>
      {open && metrics && (
        <div className="aq-perf-detail" id="aq-perf-detail" role="dialog" aria-label="Mesures de performance">
          <CarteMetrics metrics={metrics} mode={mode} rows={[["Capteurs simulés", String(sensors)]]} />
          <p className="aq-note">Mesuré en direct dans ce navigateur : les chiffres dépendent de la machine et de son GPU.</p>
        </div>
      )}
    </div>
  );
}
