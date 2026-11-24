"use client";
import { useEffect, useState } from "react";
import type { Metrics, MetricsSnapshot } from "../metrics";
import type { Sources } from "../sources";
import type { DataStore } from "../store";

const f = (v: number, d = 1) => v.toFixed(d);

export function MetricsPanel({ metrics, sources, ds, mode }: { metrics: Metrics; sources: Sources; ds: DataStore; mode: string }) {
  const [m, setM] = useState<MetricsSnapshot | null>(null);
  const [ev, setEv] = useState(0);
  useEffect(() => {
    let last = 0;
    let lastT = performance.now();
    const t = setInterval(() => {
      setM(metrics.snapshot());
      const c = ds.store.getState().counters.salesEvents;
      const now = performance.now();
      setEv(((c - last) * 1000) / (now - lastT));
      last = c;
      lastT = now;
    }, 500);
    return () => clearInterval(t);
  }, [metrics, ds]);
  if (!m) return null;
  return (
    <div className="metrics" aria-live="off" data-testid="metrics">
      <div className="row"><span>FPS</span><b>{f(m.fps, 0)}</b></div>
      <div className="row"><span>Frame p50 / p95</span><b>{f(m.frameP50)} / {f(m.frameP95)} ms</b></div>
      <div className="row"><span>JS / frame p50 / p95</span><b>{f(m.workP50)} / {f(m.workP95)} ms</b></div>
      <div className="row"><span>Captures / frame</span><b>{f(m.capturesPerFrame, 2)}</b></div>
      <div className="row"><span>Temps moyen / capture</span><b>{f(m.captureMs, 2)} ms</b></div>
      <div className="row"><span>File de recapture</span><b>{m.queue}</b></div>
      <div className="row"><span>Latence donnée→pixel p50 / p95</span><b>{f(m.latP50, 0)} / {f(m.latP95, 0)} ms</b></div>
      <div className="row"><span>Mémoire GPU (textures)</span><b>{f(m.gpuMB)} Mo</b></div>
      <div className="row"><span>Tas JS / nœuds DOM</span><b>{f(m.heapMB, 0)} Mo / {m.domNodes}</b></div>
      <div className="row"><span>Cartes montées ({mode})</span><b>{m.mounted}</b></div>
      <div className="row"><span>Ventes SSE / s · SSE</span><b>{f(ev, 0)} · {sources.stats.sse}</b></div>
    </div>
  );
}
