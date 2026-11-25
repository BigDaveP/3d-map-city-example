"use client";
/**
 * Flux SSE des capteurs, une connexion par visiteur. À chaque changement d'horloge ou d'incident, et
 * après une coupure, on rouvre avec l'heure simulée courante comme `t0` : la reconnexion automatique
 * d'EventSource renverrait l'ancienne URL, donc l'ancienne heure, et l'état reculerait.
 *
 * Mesures : chaque message est une mise à jour (`Metrics.beginUpdate`/`endUpdate`) qui va de la
 * réception au rendu React synchrone qu'il déclenche (couches de la carte, `setFeatureState` des
 * conduites, tubes, composants abonnés) ; la latence lecture → pixel est mesurée par les étiquettes
 * (`SensorTag.onShown`), dans chaque mode, à l'image qui affiche la valeur.
 */
import { useEffect } from "react";
import { EXTRA_TAGS_MAX } from "@/lib/aqueduc/city";
import type { Metrics } from "../hic3d/metrics";
import { aqueducStore, incidentQuery, simNow, type AqState } from "./store";
import { useAq } from "./useAq";


interface Message {
  t: number;
  r: [number, number][];
  p: number[];
  q: number[];
  s: AqState["live"]["sectors"];
  /** points supplémentaires du banc (seulement avec `extra`) */
  x?: [number, number][];
}

export function useAqueducStream(metrics: Metrics | null) {
  const clock = useAq((s) => s.clock);
  const incident = useAq((s) => s.incident);
  const bench = useAq((s) => s.benchTags);
  useEffect(() => {
    if (!metrics) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const open = () => {
      const { clock, incident } = aqueducStore.getState();
      const iq = incidentQuery(incident);
      const extra = bench === null ? 0 : Math.min(EXTRA_TAGS_MAX, Math.max(0, bench));
      es = new EventSource(`/api/aqueduc/stream?t0=${Math.round(simNow())}&speed=${clock.speed}${iq ? `&${iq}` : ""}${extra ? `&extra=${extra}` : ""}`);
      es.addEventListener("r", (ev) => {
        const received = performance.now();
        metrics.beginUpdate();
        const m = JSON.parse((ev as MessageEvent<string>).data) as Message;
        aqueducStore.setState({
          live: { t: m.t, readings: m.r, pressure: Float32Array.from(m.p), chlorine: Float32Array.from(m.q), sectors: m.s, extra: m.x ?? [], receivedAt: received },
        });
        // les composants abonnés au store (useSyncExternalStore) sont rendus dans une microtâche
        // mise en file pendant setState : celle-ci passe après
        queueMicrotask(() => metrics.endUpdate());
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
  }, [metrics, clock, incident, bench]);
}
