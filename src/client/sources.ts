/**
 * Connexion aux sources hétérogènes. Chaque source pousse dans le lot en attente du store ;
 * le lot est appliqué une fois par frame par la boucle de rendu (voir `flush`).
 */
import { PERIOD } from "@/lib/sim/generators";
import type { Alert, Manager } from "@/lib/sim/types";
import type { DataStore } from "./store";

export interface SourceStats {
  sse: "connexion" | "ouvert" | "erreur" | "fermé";
  sseMessages: number;
  polls: { staff: number; reviews: number; weather: number };
  lastError?: string;
}

export class Sources {
  stats: SourceStats = { sse: "fermé", sseMessages: 0, polls: { staff: 0, reviews: 0, weather: 0 } };
  private es?: EventSource;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private speed = 1;
  private stopped = true;
  private safety?: ReturnType<typeof setInterval>;

  constructor(private ds: DataStore, private n: number) {}

  start(speed: number) {
    this.stop();
    this.stopped = false;
    this.speed = speed;
    const q = `n=${this.n}&speed=${speed}`;
    this.stats.sse = "connexion";
    const es = new EventSource(`/api/sales/stream?${q}&seed=${(Math.random() * 1e9) | 0}`);
    this.es = es;
    es.addEventListener("open", () => (this.stats.sse = "ouvert"));
    es.addEventListener("error", () => (this.stats.sse = es.readyState === EventSource.CLOSED ? "fermé" : "erreur"));
    es.addEventListener("sales", (ev) => {
      const at = performance.now();
      this.stats.sseMessages++;
      const msg = JSON.parse((ev as MessageEvent).data) as { e: [number, number, number][] };
      this.ds.pushSales(msg.e, at);
    });
    this.poll("staff", PERIOD.staff);
    this.poll("reviews", PERIOD.reviews);
    this.poll("weather", PERIOD.weather);
    // garde-fou : onglet en arrière-plan => pas de rAF, on applique quand même de temps en temps
    this.safety = setInterval(() => {
      if (this.ds.pendingCount() > 20_000) this.ds.flush();
    }, 1000);
  }

  private poll(kind: "staff" | "reviews" | "weather", period: number) {
    const run = async () => {
      if (this.stopped) return;
      const tick = this.ds.store.getState().ticks[kind] + 1;
      try {
        const r = await fetch(`/api/${kind}?n=${this.n}&tick=${tick}`, { cache: "no-store" });
        const body = await r.json();
        if (this.stopped) return;
        const at = performance.now();
        this.stats.polls[kind]++;
        if (kind === "staff") this.ds.pushStaff(body.data, tick, at);
        else if (kind === "reviews") this.ds.pushReviews(body.data, tick, at);
        else this.ds.pushWeather(body.data, tick, at);
      } catch (e) {
        this.stats.lastError = `${kind}: ${(e as Error).message}`;
      }
      this.timers.push(setTimeout(run, period / this.speed));
    };
    this.timers.push(setTimeout(run, period / this.speed));
  }

  stop() {
    this.stopped = true;
    this.es?.close();
    this.es = undefined;
    this.stats.sse = "fermé";
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    clearInterval(this.safety);
  }

  /** Lecture initiale des données persistées (notes, responsables, alertes). */
  async loadPersisted() {
    const [notes, assign, alerts] = await Promise.all([
      fetch("/api/notes", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/assign", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/alerts", { cache: "no-store" }).then((r) => r.json()),
    ]);
    const p = notes.persistence as { mode: string; reason?: string };
    this.ds.setPersisted({
      notes: notes.notes,
      assign: assign.assignments,
      managers: assign.managers as Manager[],
      persistence: p.mode === "postgres" ? "Postgres" : `mémoire (${p.reason})`,
    });
    this.ds.setManualAlerts(alerts.alerts as Alert[], performance.now());
  }

  async storm(seed?: number) {
    const at = performance.now();
    const r = await fetch(`/api/storm?n=${this.n}&seed=${seed ?? 0}`, { method: "POST" });
    const body = await r.json();
    this.ds.pushStorm(body.changes, body.seed, at);
    return body.changes.length as number;
  }
}
