"use client";
/**
 * Flux SSE des capteurs, une connexion par visiteur. À chaque changement d'horloge ou d'incident, et
 * après une coupure, on rouvre avec l'heure simulée courante comme `t0` : la reconnexion automatique
 * d'EventSource renverrait l'ancienne URL, donc l'ancienne heure, et l'état reculerait.
 */
import { useEffect } from "react";
import type { Metrics } from "../metrics";
import { aqueducStore, incidentQuery, simNow, type AqState } from "./store";
import { useAq } from "./useAq";

interface Message {
  t: number;
  r: [number, number][];
  p: number[];
  q: number[];
  s: AqState["live"]["sectors"];
}

export function useAqueducStream(metrics: Metrics | null) {
  const clock = useAq((s) => s.clock);
  const incident = useAq((s) => s.incident);
  useEffect(() => {
    if (!metrics) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const open = () => {
      const { clock, incident } = aqueducStore.getState();
      const iq = incidentQuery(incident);
      es = new EventSource(`/api/aqueduc/stream?t0=${Math.round(simNow())}&speed=${clock.speed}${iq ? `&${iq}` : ""}`);
      es.addEventListener("r", (ev) => {
        const received = performance.now();
        const m = JSON.parse((ev as MessageEvent<string>).data) as Message;
        aqueducStore.setState({
          live: { t: m.t, readings: m.r, pressure: Float32Array.from(m.p), chlorine: Float32Array.from(m.q), sectors: m.s },
        });
        metrics.addWork(performance.now() - received);
        // latence lecture → pixel : l'image suivante affiche les valeurs (DOM et feature-state)
        requestAnimationFrame(() => requestAnimationFrame(() => metrics.latency(performance.now() - received)));
      });
      es.onerror = () => {
        es?.close();
        if (!disposed) retry = setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      disposed = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [metrics, clock, incident]);
}
