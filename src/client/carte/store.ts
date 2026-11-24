/**
 * Store unique de la carte, partagé par le mode classique et le mode HTML-in-Canvas.
 *  - état React (Zustand) : restaurants, panneaux ouverts, options d'affichage ;
 *  - état chaud hors React : positions des livreurs (interpolées à chaque frame).
 */
import { createStore, useStore } from "zustand";
import { COURIERS, RESTAURANTS, type CityId } from "@/lib/carte/catalog";
import type { RestaurantLive } from "@/lib/carte/sim";

export type CarteMode = "classic" | "hic";
export type Orientation = "billboard" | "facade";

export interface RestaurantView extends RestaurantLive {
  note: string;
}

export interface CarteState {
  city: CityId;
  mode: CarteMode;
  orientation: Orientation;
  fog: boolean;
  shadow: boolean;
  pulse: boolean;
  /** effet de transition à l'ouverture d'un panneau */
  transition: "dissolve" | "sweep" | "none";
  /** durée de la transition d'ouverture (ms) */
  transitionMs: number;
  restaurants: RestaurantView[];
  assignments: Record<string, string>;
  persistence: string;
  openRestaurants: number[];
  openCouriers: number[];
  api: "absente" | "détectée" | "active";
  apiDetail: string;
  fallback: string;
  robotOpen: boolean;
  recording: "" | "enregistrement" | "prêt";
}

const initial: CarteState = {
  city: "mtl",
  mode: "hic",
  orientation: "billboard",
  fog: true,
  shadow: true,
  pulse: true,
  transition: "dissolve",
  transitionMs: 700,
  restaurants: RESTAURANTS.map(() => ({ status: "ouvert", pending: 0, prepMin: 0, dispatched: 0, note: "" })),
  assignments: {},
  persistence: "…",
  openRestaurants: [],
  openCouriers: [],
  api: "absente",
  apiDetail: "",
  fallback: "",
  robotOpen: false,
  recording: "",
};

export const carteStore = createStore<CarteState>()(() => initial);
export const useCarte = <T,>(sel: (s: CarteState) => T) => useStore(carteStore, sel);

/** Instant (performance.now) de réception du dernier changement visible par restaurant : base de la latence. */
export const statusChangedAt = new Float64Array(RESTAURANTS.length);

/** Positions des livreurs : interpolation entre les deux derniers messages SSE. */
export class CourierLive {
  readonly n = COURIERS.length;
  prev = new Float64Array(this.n * 2);
  next = new Float64Array(this.n * 2);
  t0 = new Float64Array(this.n);
  t1 = new Float64Array(this.n);
  heading = new Float32Array(this.n);
  target = new Int16Array(this.n).fill(-1);
  eta = new Int32Array(this.n);
  order: string[] = new Array(this.n).fill("");
  known = new Uint8Array(this.n);
  version = 0;
  /** dernière mise à jour du texte affiché (commande, ETA, destination) */
  textVersion = new Uint32Array(this.n);

  push(msg: (number | string)[][], at: number) {
    for (const [i, lng, lat, heading, target, eta, order] of msg as [number, number, number, number, number, number, string][]) {
      const cur = this.position(i, at);
      this.prev[i * 2] = this.known[i] ? cur[0] : lng;
      this.prev[i * 2 + 1] = this.known[i] ? cur[1] : lat;
      this.next[i * 2] = lng;
      this.next[i * 2 + 1] = lat;
      this.t0[i] = at;
      this.t1[i] = at + 1200;
      this.heading[i] = heading;
      if (this.target[i] !== target || this.order[i] !== order) this.textVersion[i]++;
      this.target[i] = target;
      this.eta[i] = eta;
      this.order[i] = order;
      this.known[i] = 1;
    }
    this.version++;
  }

  position(i: number, now: number): [number, number] {
    const f = Math.min(1, Math.max(0, (now - this.t0[i]) / Math.max(1, this.t1[i] - this.t0[i])));
    return [this.prev[i * 2] + (this.next[i * 2] - this.prev[i * 2]) * f, this.prev[i * 2 + 1] + (this.next[i * 2 + 1] - this.prev[i * 2 + 1]) * f];
  }

  /** vrai si au moins un livreur est en cours d'interpolation (=> redessin nécessaire) */
  moving(now: number) {
    for (let i = 0; i < this.n; i++) if (this.known[i] && now < this.t1[i]) return true;
    return false;
  }
}

export const couriers = new CourierLive();

/** Applique un instantané /api/carte/restaurants. */
export function applyRestaurants(rows: RestaurantView[], assignments: Record<string, string>, persistence: string, at: number) {
  const s = carteStore.getState();
  const next = s.restaurants.slice();
  let changed = false;
  rows.forEach((r, i) => {
    const cur = s.restaurants[i];
    if (cur.status !== r.status || cur.pending !== r.pending || cur.prepMin !== r.prepMin || cur.dispatched !== r.dispatched || cur.note !== r.note) {
      if (cur.status !== r.status || cur.pending !== r.pending || cur.dispatched !== r.dispatched) statusChangedAt[i] = at;
      next[i] = r;
      changed = true;
    }
  });
  if (changed || s.persistence !== persistence) carteStore.setState({ restaurants: next, assignments, persistence });
}

export function toggleRestaurant(idx: number, open?: boolean) {
  const cur = carteStore.getState().openRestaurants;
  const isOpen = cur.includes(idx);
  const want = open ?? !isOpen;
  if (want === isOpen) return;
  carteStore.setState({ openRestaurants: want ? [...cur, idx] : cur.filter((x) => x !== idx) });
}

export function toggleCourier(idx: number, open?: boolean) {
  const cur = carteStore.getState().openCouriers;
  const isOpen = cur.includes(idx);
  const want = open ?? !isOpen;
  if (want === isOpen) return;
  carteStore.setState({ openCouriers: want ? [...cur, idx] : cur.filter((x) => x !== idx) });
}
