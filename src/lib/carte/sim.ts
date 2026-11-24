/**
 * Simulation déterministe (fonction du temps) : positions des livreurs et état des restaurants.
 * Sans état côté serveur : deux clients voient la même ville au même instant.
 */
import { rand01 } from "../sim/random";
import { COURIERS, RESTAURANTS, type Courier } from "./catalog";

export type RestaurantStatus = "ouvert" | "achalandé" | "pause";

export interface RestaurantLive {
  status: RestaurantStatus;
  pending: number;
  prepMin: number;
  /** livreurs envoyés manuellement (Server Action), compteur côté serveur */
  dispatched: number;
}

export interface CourierLive {
  lng: number;
  lat: number;
  heading: number;
  /** restaurant vers lequel le livreur se dirige */
  target: number;
  /** temps restant estimé (s) */
  eta: number;
  /** commande en cours (identifiant fictif) */
  order: string;
}

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

interface Leg {
  from: [number, number];
  to: [number, number];
  len: number;
  target: number;
}

const legsCache = new Map<number, { legs: Leg[]; total: number }>();

/** Boucle du livreur : restaurant -> client (détour) -> restaurant suivant… */
export function courierLegs(c: Courier) {
  const hit = legsCache.get(c.idx);
  if (hit) return hit;
  const legs: Leg[] = [];
  const pts: { p: [number, number]; target: number }[] = [];
  c.route.forEach((r, k) => {
    const a = RESTAURANTS[r];
    const b = RESTAURANTS[c.route[(k + 1) % c.route.length]];
    pts.push({ p: [a.lng, a.lat], target: b.idx });
    // détour vers un « client » fictif entre les deux restaurants
    const t = 0.5 + (rand01("client", c.idx, k) - 0.5) * 0.4;
    const off = (rand01("off", c.idx, k) - 0.5) * 0.004;
    pts.push({ p: [a.lng + (b.lng - a.lng) * t + off, a.lat + (b.lat - a.lat) * t - off * 0.7], target: b.idx });
  });
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const from = pts[i].p;
    const to = pts[(i + 1) % pts.length].p;
    const dx = (to[0] - from[0]) * mPerDegLng(from[1]);
    const dy = (to[1] - from[1]) * M_PER_DEG_LAT;
    const len = Math.max(1, Math.hypot(dx, dy));
    legs.push({ from, to, len, target: pts[i].target });
    total += len;
  }
  const r = { legs, total };
  legsCache.set(c.idx, r);
  return r;
}

export function courierAt(c: Courier, tMs: number, assigned?: number): CourierLive {
  const { legs, total } = courierLegs(c);
  let d = ((tMs / 1000) * c.speed + rand01("phase", c.idx) * total) % total;
  let i = 0;
  while (d > legs[i].len) {
    d -= legs[i].len;
    i++;
  }
  const leg = legs[i];
  const f = d / leg.len;
  const lng = leg.from[0] + (leg.to[0] - leg.from[0]) * f;
  const lat = leg.from[1] + (leg.to[1] - leg.from[1]) * f;
  const heading = (Math.atan2((leg.to[0] - leg.from[0]) * mPerDegLng(lat), (leg.to[1] - leg.from[1]) * M_PER_DEG_LAT) * 180) / Math.PI;
  // distance restante jusqu'au prochain restaurant de la boucle
  let rest = leg.len - d;
  for (let k = i + 1; k < legs.length + i && legs[k % legs.length].target === leg.target; k++) rest += legs[k % legs.length].len;
  const lap = Math.floor(((tMs / 1000) * c.speed) / total);
  return {
    lng,
    lat,
    heading,
    target: assigned ?? leg.target,
    eta: Math.round(rest / c.speed),
    order: `C-${(c.idx * 97 + lap * 13 + i) % 9000 + 1000}`,
  };
}

/** Vague lente : la charge d'un restaurant varie sur quelques minutes (×vitesse). */
export function restaurantAt(idx: number, tMs: number, paused: boolean, dispatched = 0): RestaurantLive {
  const r = RESTAURANTS[idx];
  const bucket = Math.floor(tMs / 6000);
  const wave = Math.sin(tMs / (90_000 + rand01("per", idx) * 120_000) + rand01("ph", idx) * 6.28);
  const noise = rand01("noise", idx, bucket) - 0.5;
  const pending = Math.max(0, Math.round(r.load + wave * 4 + noise * 2));
  const prepMin = Math.round(8 + pending * 1.6 + (rand01("prep", idx, bucket) - 0.5) * 3);
  const status: RestaurantStatus = paused ? "pause" : pending >= r.load + 3 ? "achalandé" : "ouvert";
  return { status, pending: paused ? 0 : pending, prepMin, dispatched };
}

export const COURIER_COUNT = COURIERS.length;
