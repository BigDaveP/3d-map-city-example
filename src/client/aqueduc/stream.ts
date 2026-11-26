/**
 * Flux SSE des capteurs, une connexion par visiteur. À chaque changement de l'horloge commune ou de
 * l'incident qui en découle (`incidentQuery`), et après une coupure, on rouvre avec l'heure simulée
 * courante comme `t0` : la reconnexion automatique d'EventSource renverrait l'ancienne URL, donc
 * l'ancienne heure, et l'état reculerait.
 *
 * Mesures : chaque message est une mise à jour (`Metrics.beginUpdate`/`endUpdate`) qui va de la
 * réception au rendu React synchrone qu'il déclenche (couches de la carte, `setFeatureState` des
 * conduites, tubes, composants abonnés) ; la latence lecture → pixel est mesurée par les étiquettes
 * (`SensorTag.onShown`), dans chaque mode, à l'image qui affiche la valeur.
 */
import { EXTRA_TAGS_MAX } from "@/lib/aqueduc/city";
import type { Metrics } from "../hic3d/metrics";
import { simNow, territoireStore } from "../territoire/store";
import { aqueducStore, incidentQuery, type AqState } from "./store";

interface Message {
  t: number;
  r: [number, number][];
  p: number[];
  q: number[];
  s: AqState["live"]["sectors"];
  /** points supplémentaires du banc (seulement avec `extra`) */
  x?: [number, number][];
}

/**
 * Ouvre le flux et le rouvre à chaque changement de l'horloge, de l'incident ou du nombre
 * d'étiquettes du banc (une seule fois pour une rafale de changements dans la même tâche, comme le
 * lancement du scénario) ; renvoie la fonction qui le ferme (démontage de l'environnement).
 */
export function attachStream(metrics: Metrics): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const open = () => {
    es?.close();
    clearTimeout(retry);
    const { speed } = territoireStore.getState().clock;
    const { benchTags: bench, incident } = aqueducStore.getState();
    const iq = incidentQuery(incident);
    const extra = bench === null ? 0 : Math.min(EXTRA_TAGS_MAX, Math.max(0, bench));
    const cur = new EventSource(`/api/aqueduc/stream?t0=${Math.round(simNow())}&speed=${speed}${iq ? `&${iq}` : ""}${extra ? `&extra=${extra}` : ""}`);
    es = cur;
    cur.addEventListener("r", (ev) => {
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
    cur.onerror = () => {
      cur.close();
      if (!disposed && es === cur) retry = setTimeout(open, 1000);
    };
  };
  let pending = false;
  const reopen = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!disposed) open();
    });
  };
  open();
  const offClock = territoireStore.subscribe((s, prev) => s.clock !== prev.clock && reopen());
  const offAq = aqueducStore.subscribe((s, prev) => {
    if (s.benchTags !== prev.benchTags || incidentQuery(s.incident) !== incidentQuery(prev.incident)) reopen();
  });
  return () => {
    disposed = true;
    offClock();
    offAq();
    clearTimeout(retry);
    es?.close();
    es = null;
  };
}
