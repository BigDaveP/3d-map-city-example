/**
 * Store client unique (Zustand). Fusionne les sources hétérogènes (SSE, polling, actions)
 * et sert les deux modes de rendu. Les mises à jour sont appliquées par lot une fois par frame.
 */
import { createStore, useStore } from "zustand";
import { getBranches } from "@/lib/sim/catalog";
import { rand01 } from "@/lib/sim/random";
import { initialSales, nextPace, reviewsAt, salesBaseline, staffAt, weatherAt } from "@/lib/sim/generators";
import { alertsStatus, reviewsStatus, salesStatus, staffStatus, weatherStatus } from "@/lib/sim/status";
import {
  type Alert,
  type Branch,
  cardId,
  KINDS,
  type Kind,
  type Manager,
  type ReviewsState,
  type SalesState,
  type StaffState,
  type Status,
  type StormChange,
  type WeatherState,
} from "@/lib/sim/types";
import { LiveState } from "./live";

export interface DataState {
  n: number;
  branches: Branch[];
  sales: SalesState[];
  staff: StaffState[];
  reviews: ReviewsState[];
  weather: WeatherState[];
  /** Alertes affichées par succursale (auto + manuelles + tempête). */
  alerts: Alert[][];
  manualAlerts: Alert[];
  stormAlerts: Alert[];
  notes: Record<string, string>;
  assign: Record<string, number>;
  managers: Manager[];
  persistence: string;
  ticks: { staff: number; reviews: number; weather: number };
  counters: { salesEvents: number; batches: number; storms: number };
}

/** Lot de modifications accumulées entre deux frames. */
export interface PendingBatch {
  sales: { e: [number, number, number][]; at: number }[];
  staff?: { data: StaffState[]; at: number; tick: number };
  reviews?: { data: ReviewsState[]; at: number; tick: number };
  weather?: { data: WeatherState[]; at: number; tick: number };
  storm?: { changes: StormChange[]; at: number; seed: number };
  alertsChanged?: number;
}

const AUTO_MSG: Partial<Record<Kind, string>> = {
  sales: "Rythme de ventes faible",
  staff: "Sous-effectif",
  reviews: "Satisfaction en chute",
  weather: "Vigilance orage",
};

export function statusOf(s: DataState, branch: number, kind: Kind): Status {
  switch (kind) {
    case "sales":
      return salesStatus(s.sales[branch]);
    case "staff":
      return staffStatus(s.staff[branch]);
    case "reviews":
      return reviewsStatus(s.reviews[branch]);
    case "weather":
      return weatherStatus(s.weather[branch]);
    case "alerts":
      return alertsStatus(s.alerts[branch]);
  }
}

/** Signature de ce qu'affiche le HTML de la carte (hors sparkline, hors champs saisis). */
export function htmlSignature(s: DataState, branch: number, kind: Kind): string {
  const st = statusOf(s, branch, kind);
  switch (kind) {
    case "sales": {
      const v = s.sales[branch];
      return `${st}|${Math.round(v.revenue)}|${v.transactions}|${Math.round(v.pace * 100)}`;
    }
    case "staff": {
      const v = s.staff[branch];
      return `${st}|${v.onDuty}|${v.scheduled}|${v.late}|${v.vacancies}`;
    }
    case "reviews": {
      const v = s.reviews[branch];
      return `${st}|${v.rating}|${v.count}|${v.last.author}|${v.last.text}|${v.last.stars}`;
    }
    case "weather": {
      const v = s.weather[branch];
      return `${st}|${v.condition}|${v.temp}`;
    }
    case "alerts": {
      const a = s.alerts[branch];
      return `${st}|${a.length}|${a.slice(0, 3).map((x) => x.id).join(",")}`;
    }
  }
}

function computeAlerts(s: Pick<DataState, "branches" | "sales" | "staff" | "reviews" | "weather" | "manualAlerts" | "stormAlerts">, b: number): Alert[] {
  const br = s.branches[b];
  const out: Alert[] = [];
  for (const a of s.stormAlerts) if (a.branchId === br.id) out.push(a);
  for (const a of s.manualAlerts) if (a.branchId === br.id) out.push(a);
  const auto: [Kind, Status][] = [
    ["sales", salesStatus(s.sales[b])],
    ["staff", staffStatus(s.staff[b])],
    ["reviews", reviewsStatus(s.reviews[b])],
    ["weather", weatherStatus(s.weather[b])],
  ];
  for (const [k, st] of auto) {
    if (st === 2) out.push({ id: `auto-${br.id}-${k}`, branchId: br.id, kind: k, level: 1, message: AUTO_MSG[k]!, createdAt: "", source: "auto" });
  }
  return out;
}

export function createDataStore(n: number) {
  const branches = getBranches(n);
  const live = new LiveState(branches.length * KINDS.length);
  const base = {
    branches,
    sales: branches.map(initialSales),
    staff: branches.map((b) => staffAt(b, 0)),
    reviews: branches.map((b) => reviewsAt(b, 0)),
    weather: branches.map((b) => weatherAt(b, 0)),
    manualAlerts: [] as Alert[],
    stormAlerts: [] as Alert[],
  };
  const init: DataState = {
    n,
    ...base,
    alerts: branches.map((_, b) => computeAlerts(base, b)),
    notes: {},
    assign: {},
    managers: [],
    persistence: "…",
    ticks: { staff: 0, reviews: 0, weather: 0 },
    counters: { salesEvents: 0, batches: 0, storms: 0 },
  };
  // amorce des sparklines et des signatures
  for (let b = 0; b < branches.length; b++) {
    const base = salesBaseline(branches[b]);
    for (let i = 0; i < 24; i++) live.pushSpark(b, base * (0.4 + rand01("spark0", b, i) * 1.2));
    KINDS.forEach((k, ki) => {
      const c = b * KINDS.length + ki;
      live.sig[c] = htmlSignature(init, b, k);
      live.statuses[c] = statusOf(init, b, k);
    });
  }
  live.statusVersion++;

  const store = createStore<DataState>()(() => init);
  let pending: PendingBatch = { sales: [] };
  let pendingCount = 0;

  /** Applique le lot en attente : un seul `setState`, donc un seul rendu React. */
  function flush(): number {
    if (!pendingCount) return 0;
    const batch = pending;
    pending = { sales: [] };
    const applied = pendingCount;
    pendingCount = 0;

    const s = store.getState();
    const touched = new Map<number, number>(); // branche -> receivedAt le plus ancien
    const touch = (b: number, at: number) => {
      const prev = touched.get(b);
      if (prev === undefined || at < prev) touched.set(b, at);
    };
    let sales = s.sales;
    let staff = s.staff;
    let reviews = s.reviews;
    let weather = s.weather;
    let stormAlerts = s.stormAlerts;
    let salesEvents = 0;

    if (batch.sales.length) {
      sales = sales.slice();
      for (const msg of batch.sales) {
        for (const [b, amount, tx] of msg.e) {
          if (b >= sales.length) continue;
          const prev = sales[b];
          sales[b] = {
            revenue: prev.revenue + amount,
            transactions: prev.transactions + tx,
            pace: nextPace(prev.pace, amount, salesBaseline(s.branches[b])),
            updatedAt: msg.at,
          };
          live.pushSpark(b, amount);
          touch(b, msg.at);
          salesEvents++;
        }
      }
    }
    const applySnapshot = <T,>(cur: T[], snap: { data: T[]; at: number } | undefined, eq: (a: T, b: T) => boolean): T[] => {
      if (!snap) return cur;
      const next = cur.slice();
      for (let b = 0; b < next.length && b < snap.data.length; b++) {
        if (!eq(cur[b], snap.data[b])) {
          next[b] = snap.data[b];
          touch(b, snap.at);
        }
      }
      return next;
    };
    staff = applySnapshot(staff, batch.staff, (a, b) => a.onDuty === b.onDuty && a.late === b.late && a.vacancies === b.vacancies && a.scheduled === b.scheduled);
    reviews = applySnapshot(reviews, batch.reviews, (a, b) => a.rating === b.rating && a.count === b.count && a.last.text === b.last.text && a.last.author === b.last.author);
    weather = applySnapshot(weather, batch.weather, (a, b) => a.condition === b.condition && a.temp === b.temp);

    if (batch.storm) {
      const at = batch.storm.at;
      sales = sales === s.sales ? sales.slice() : sales;
      staff = staff === s.staff ? staff.slice() : staff;
      reviews = reviews === s.reviews ? reviews.slice() : reviews;
      weather = weather === s.weather ? weather.slice() : weather;
      const newStorm: Alert[] = [];
      for (const ch of batch.storm.changes) {
        const b = Math.floor(ch.card / KINDS.length);
        if (b >= s.branches.length) continue;
        const p = ch.patch as Record<string, never>;
        switch (ch.kind) {
          case "sales":
            sales[b] = { ...sales[b], pace: p.pace, revenue: Math.max(0, sales[b].revenue - p.refund), updatedAt: at };
            live.pushSpark(b, 0);
            break;
          case "staff": {
            const v = staff[b];
            staff[b] = { ...v, late: p.late, vacancies: p.vacancies, onDuty: Math.max(1, v.scheduled - p.vacancies - p.late) };
            break;
          }
          case "reviews": {
            const v = reviews[b];
            reviews[b] = { rating: Math.max(1, Math.round((v.rating + Number(p.ratingDelta)) * 10) / 10), count: v.count + 1, last: p.last };
            break;
          }
          case "weather":
            weather[b] = { condition: p.condition, temp: p.temp };
            break;
          case "alerts":
            newStorm.push({ id: `storm-${batch.storm.seed}-${b}`, branchId: s.branches[b].id, kind: "alerts", level: 2, message: p.message, createdAt: new Date().toISOString(), source: "tempête" });
            break;
        }
        touch(b, at);
      }
      // les alertes de tempête précédentes sont remplacées par les nouvelles
      for (const a of stormAlerts) touch(s.branches.findIndex((x) => x.id === a.branchId), at);
      stormAlerts = newStorm;
    }
    if (batch.alertsChanged !== undefined) for (let b = 0; b < s.branches.length; b++) touch(b, batch.alertsChanged);

    const next: DataState = {
      ...s,
      sales,
      staff,
      reviews,
      weather,
      stormAlerts,
      alerts: s.alerts,
      ticks: {
        staff: batch.staff?.tick ?? s.ticks.staff,
        reviews: batch.reviews?.tick ?? s.ticks.reviews,
        weather: batch.weather?.tick ?? s.ticks.weather,
      },
      counters: { salesEvents: s.counters.salesEvents + salesEvents, batches: s.counters.batches + 1, storms: s.counters.storms + (batch.storm ? 1 : 0) },
    };
    // alertes dérivées + signatures/statuts des cartes touchées
    let alerts: Alert[][] | null = null;
    for (const [b, at] of touched) {
      if (b < 0) continue;
      const a = computeAlerts(next, b);
      const prevA = s.alerts[b];
      if (a.length !== prevA.length || a.some((x, i) => x.id !== prevA[i].id)) {
        alerts ??= s.alerts.slice();
        alerts[b] = a;
      }
    }
    if (alerts) next.alerts = alerts;
    for (const [b, at] of touched) {
      if (b < 0) continue;
      for (let k = 0; k < KINDS.length; k++) {
        const c = b * KINDS.length + k;
        live.setStatus(c, statusOf(next, b, KINDS[k]));
        live.updateSig(c, htmlSignature(next, b, KINDS[k]), at);
      }
    }
    store.setState(next, true);
    live.emit();
    return applied;
  }

  const api = {
    store,
    live,
    flush,
    pendingCount: () => pendingCount,
    pushSales(e: [number, number, number][], at: number) {
      pending.sales.push({ e, at });
      pendingCount += e.length;
    },
    pushStaff(data: StaffState[], tick: number, at: number) {
      pending.staff = { data, tick, at };
      pendingCount++;
    },
    pushReviews(data: ReviewsState[], tick: number, at: number) {
      pending.reviews = { data, tick, at };
      pendingCount++;
    },
    pushWeather(data: WeatherState[], tick: number, at: number) {
      pending.weather = { data, tick, at };
      pendingCount++;
    },
    pushStorm(changes: StormChange[], seed: number, at: number) {
      pending.storm = { changes, seed, at };
      pendingCount += changes.length;
    },
    setManualAlerts(manualAlerts: Alert[], at: number) {
      store.setState({ manualAlerts });
      pending.alertsChanged = at;
      pendingCount++;
    },
    setPersisted(p: Partial<Pick<DataState, "notes" | "assign" | "managers" | "persistence">>) {
      store.setState(p);
    },
    setNote(id: string, body: string) {
      store.setState((s) => ({ notes: { ...s.notes, [id]: body } }));
    },
    setAssign(id: string, managerId: number) {
      store.setState((s) => ({ assign: { ...s.assign, [id]: managerId } }));
    },
    cardIdOf(card: number) {
      const b = store.getState().branches[Math.floor(card / KINDS.length)];
      return cardId(b.id, KINDS[card % KINDS.length]);
    },
  };
  return api;
}

export type DataStore = ReturnType<typeof createDataStore>;

export function useData<T>(ds: DataStore, sel: (s: DataState) => T): T {
  return useStore(ds.store, sel);
}
