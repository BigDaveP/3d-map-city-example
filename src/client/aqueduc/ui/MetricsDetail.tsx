"use client";
import { useEffect, useState } from "react";
import type { Metrics, MetricsSnapshot } from "../../hic3d/metrics";

const f = (v: number, d = 1) => v.toFixed(d);

/** Détail des mesures de performance (puce de la barre) : mode, lignes propres à la démo (`rows`), puis les mesures communes. */
export function MetricsDetail({ metrics, mode, rows }: { metrics: Metrics; mode: "classic" | "hic"; rows: [string, string][] }) {
  const [m, setM] = useState<MetricsSnapshot | null>(null);
  const [perMin, setPerMin] = useState(0);
  useEffect(() => {
    let last = metrics.captureTotal;
    let lastT = performance.now();
    const t = setInterval(() => {
      setM(metrics.snapshot());
      const now = performance.now();
      setPerMin(((metrics.captureTotal - last) * 60000) / (now - lastT));
      last = metrics.captureTotal;
      lastT = now;
    }, 1000);
    return () => clearInterval(t);
  }, [metrics]);
  if (!m) return null;
  return (
    <div className="metrics" data-testid="metrics">
      <div className="row"><span>Mode</span><b>{mode === "hic" ? "HTML-in-Canvas" : "classique"}</b></div>
      {rows.map(([k, v]) => (
        <div className="row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
      <div className="row"><span>FPS</span><b>{f(m.fps, 0)}</b></div>
      <div className="row"><span>Frame p50 / p95</span><b>{f(m.frameP50)} / {f(m.frameP95)} ms</b></div>
      <div className="row"><span>JS / frame p95</span><b>{f(m.workP95)} ms</b></div>
      {m.updMax > 0 && (
        <>
          <div className="row"><span>JS / mise à jour p95 / max</span><b>{f(m.updP95)} / {f(m.updMax)} ms</b></div>
          <div className="row"><span>JS des mises à jour</span><b>{f(m.updMsPerSec)} ms/s</b></div>
        </>
      )}
      <div className="row"><span>Captures / min</span><b>{f(perMin, 0)}</b></div>
      <div className="row"><span>Latence statut → pixel p50 / p95</span><b>{f(m.latP50, 0)} / {f(m.latP95, 0)} ms</b></div>
      <div className="row"><span>Textures</span><b>{f(m.gpuMB)} Mo</b></div>
    </div>
  );
}
