"use client";
/**
 * Puce de performance (images/s, temps JS p95) ; un clic ouvre le détail des mesures (`MetricsDetail`) et le
 * lien vers les résultats du banc (`/bench#aqueduc`). Le temps JS affiché est le plus grand des deux
 * p95 : par image, et par mise à jour des données (message du flux une fois par seconde, re-rendu des
 * étiquettes, captures) ; le p95 par image seul cacherait la mise à jour, une image sur soixante.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Metrics } from "../../hic3d/metrics";
import { num } from "../format";
import { useAq } from "../useAq";
import { MetricsDetail } from "./MetricsDetail";

/** `tubes` : statistiques de la couche des tubes souterrains (instances dessinées, 0 hors vue souterraine). */
export function PerfChip({ metrics, tubes }: { metrics: Metrics | null; tubes: { instances: number } | null }) {
  const [snap, setSnap] = useState({ fps: 0, frame: 0, update: 0, tubes: 0 });
  const [open, setOpen] = useState(false);
  const mode = useAq((s) => s.mode);
  const sensors = useAq((s) => s.live.readings.length);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!metrics) return;
    const id = setInterval(() => {
      const s = metrics.snapshot();
      setSnap({ fps: s.fps, frame: s.workP95, update: s.updP95, tubes: tubes?.instances ?? 0 });
    }, 1000);
    return () => clearInterval(id);
  }, [metrics, tubes]);
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
      <button
        type="button"
        className="aq-chip"
        aria-expanded={open}
        aria-controls="aq-perf-detail"
        onClick={() => setOpen(!open)}
        title={`Mesures de performance. Temps JS p95 : ${num(snap.frame, 1)} ms par image, ${num(snap.update, 1)} ms par mise à jour des données`}
      >
        <b className="aq-num">{num(snap.fps)} i/s</b>
        <span aria-hidden="true"> · </span>JS <span className="aq-num">{num(Math.max(snap.frame, snap.update), 1)} ms</span>
      </button>
      {open && metrics && (
        <div className="aq-perf-detail" id="aq-perf-detail" role="dialog" aria-label="Mesures de performance">
          <MetricsDetail metrics={metrics} mode={mode} rows={[["Capteurs simulés", String(sensors)], ["Tubes souterrains (instances)", num(snap.tubes)]]} />
          <p className="aq-note">
            Mesuré en direct dans ce navigateur : les chiffres dépendent de la machine et de son GPU. <Link href="/bench#aqueduc">Résultats du banc</Link>
          </p>
        </div>
      )}
    </div>
  );
}
