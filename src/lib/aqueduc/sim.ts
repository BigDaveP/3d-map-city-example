// Simulation déterministe : secteurs, capteurs et lectures à l'instant t (Simulation, aucune donnée réelle de capteur).
import { CITY, type CityConfig } from "./city";
import { distancesFrom, isolate, placeValves, type Isolation } from "./graph";
import { midpoint, type Network } from "./network";

export interface Sector {
  id: string;
  name: string;
  segments: number[];
  /** adresses estimées : (distribution + maîtresse) / 12 m, arrondi */
  addresses: number;
}

export type SensorKind = "pression" | "debit" | "qualite" | "reservoir";

export interface Sensor {
  idx: number;
  /** "P-01", "D-01", "Q-01", "R-01" */
  id: string;
  kind: SensorKind;
  node: number;
  at: [number, number];
  sector: string;
}

export interface Model {
  network: Network;
  sectors: Sector[];
  sensors: Sensor[];
  valves: Set<number>;
  /** distance (m) depuis les sources, par nœud ; nœuds non reliés : distance maximale finie */
  dist: Float64Array;
  /** secteur de chaque segment */
  sectorOf: Uint16Array;
}

export interface IncidentInput {
  segment: number;
  /** ms sim */
  startedAt: number;
  closedValves: number[];
  restoredAt: number | null;
}

export interface Reading {
  value: number;
  unit: "bar" | "L/s" | "mg/L" | "%";
  status: "ok" | "attention" | "alerte";
  extra?: { turbidity: number; ph: number; temp: number };
}

export interface SectorStat {
  id: string;
  /** adresses desservies (hors zone privée d'eau) */
  served: number;
  flowLs: number;
  /** débit de la dernière nuit (3 h) / débit de nuit attendu */
  nightRatio: number;
}

/** Seuils affichés (sources citées dans la documentation). */
export const THRESHOLDS = { chloreMin: 0.2, chloreMax: 4.0, turbidityMax: 1.0, phMin: 6.5, phMax: 8.5, pressureMin: 2.0 };

// --- constantes du modèle ---
const P_MAX = 5.2; // bar
const P_MIN_BASE = 2.4;
const P_PER_KM = 0.35;
const P_DEMAND = 0.5; // bar par unité de demande au-dessus de 0,8
const P_NOISE = 0.03;
const BREAK_DROP = 3.0; // bar au bris
const BREAK_RAMP_MS = 40_000;
const BREAK_DECAY_M = 400;
const BREAK_FLOW_LS = 45; // débit perdu au bris (conduite de 300 mm)
const RESTORE_MS = 10 * 60_000;
const CL_MAX = 1.1; // mg/L à l'usine
const CL_DECAY_M = 9000;
const CL_NOISE = 0.02;
const TURB_BASE = 0.15; // UTN
const TURB_PEAK = 0.9;
const TURB_DECAY_MS = 3_600_000;
const FLOW_PER_M = 0.004; // L/s par mètre de distribution
const LEAK_SECTOR = "Sainte-Cécile";
const LEAK_NIGHT = 0.18; // fuite = +18 % du débit de nuit attendu
const MAIN_VELOCITY = 0.6; // m/s à demande 1
const ADDRESS_M = 12;
const N_PRESSURE = 30;
const N_FLOW = 10;
const HOUR = 3_600_000;

// --- temps et bruit ---

/** Décalage de l'heure de l'Est (h) : UTC−4 de 2e dimanche de mars 2 h au 1er dimanche de novembre 2 h, sinon UTC−5. */
function easternOffset(t: number): number {
  const y = new Date(t).getUTCFullYear();
  const sunday = (month: number, nth: number) => {
    const dow = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - dow) % 7) + 7 * (nth - 1);
  };
  const start = Date.UTC(y, 2, sunday(2, 2), 7);
  const end = Date.UTC(y, 10, sunday(10, 1), 6);
  return t >= start && t < end ? -4 : -5;
}

/** Heure locale décimale [0, 24). */
export function localHour(t: number): number {
  const ms = t + easternOffset(t) * HOUR;
  return (((ms % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR)) / HOUR;
}

/** Points de la courbe de demande : [heure, D]. Minimum à 3 h, pointes à 7 h 30 et 18 h. */
const DEMAND: [number, number][] = [
  [3, 0.45],
  [7.5, 1.35],
  [12, 1.0],
  [15, 0.9],
  [18, 1.3],
  [22, 0.75],
  [27, 0.45],
];

/** Demande relative D(h) ∈ [0,45 ; 1,35], interpolation cosinus entre les points (extrêmes aux points). */
export function demand(h: number): number {
  const x = h < 3 ? h + 24 : h;
  for (let i = 1; i < DEMAND.length; i++) {
    const [h1, d1] = DEMAND[i];
    if (x <= h1) {
      const [h0, d0] = DEMAND[i - 1];
      const u = (1 - Math.cos((Math.PI * (x - h0)) / (h1 - h0))) / 2;
      return d0 + (d1 - d0) * u;
    }
  }
  return DEMAND[0][1];
}

/** Bruit déterministe dans [−1, 1] : hachage entier de (index, minute, sel). */
function noise(index: number, minute: number, salt: number): number {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(minute, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// --- géométrie locale ---

/** Projection équirectangulaire locale (m) autour d'une latitude. */
function projector(lat0: number) {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return (p: [number, number]): [number, number] => [p[0] * kx, p[1] * 110_540];
}

/** Position de chaque nœud (lng, lat) : extrémité des segments. */
function nodePositions(n: Network): Float64Array {
  const pos = new Float64Array(n.nodes.length * 2);
  for (const s of n.segments) {
    const c = s.coords;
    pos[s.a * 2] = c[0];
    pos[s.a * 2 + 1] = c[1];
    pos[s.b * 2] = c[c.length - 2];
    pos[s.b * 2 + 1] = c[c.length - 1];
  }
  return pos;
}

interface Sampler {
  cand: number[];
  xy: Float64Array;
  /** position projetée (m) d'un nœud */
  proj: (node: number) => [number, number];
}

/** Échantillonnage du point le plus éloigné : `count` nœuds de `cand`, en partant des nœuds déjà choisis. */
function farthest(s: Sampler, chosen: number[], count: number): number[] {
  const { cand, xy } = s;
  const d = new Float64Array(cand.length).fill(Infinity);
  const update = (node: number) => {
    const p = s.proj(node);
    for (let i = 0; i < cand.length; i++) {
      const dd = Math.hypot(xy[i * 2] - p[0], xy[i * 2 + 1] - p[1]);
      if (dd < d[i]) d[i] = dd;
    }
  };
  chosen.forEach(update);
  const out: number[] = [];
  while (out.length < count) {
    let best = -1;
    for (let i = 0; i < cand.length; i++) if (d[i] > 0 && (best < 0 || d[i] > d[best])) best = i;
    if (best < 0) break;
    out.push(cand[best]);
    update(cand[best]);
  }
  return out;
}

// caches propres à un modèle (le modèle reste un objet de données simple)
const samplerOf = new WeakMap<Model, Sampler>();
const caches = new WeakMap<Model, Map<string, unknown>>();
function cached<T>(m: Model, key: string, make: () => T): T {
  let c = caches.get(m);
  if (!c) caches.set(m, (c = new Map()));
  if (!c.has(key)) c.set(key, make());
  return c.get(key) as T;
}

// --- construction ---

export function buildModel(n: Network, city: CityConfig): Model {
  const pos = nodePositions(n);
  const proj = projector(city.center[1]);
  const seeds = city.sectorSeeds.map((s) => proj(s.at));
  const nearestSeed = (p: [number, number]) => {
    const q = proj(p);
    let best = 0;
    let bd = Infinity;
    seeds.forEach((s, i) => {
      const d = (s[0] - q[0]) ** 2 + (s[1] - q[1]) ** 2;
      if (d < bd) (bd = d), (best = i);
    });
    return best;
  };

  // secteurs : Voronoï des graines sur le milieu des segments
  const sectorOf = new Uint16Array(n.segments.length);
  const sectors: Sector[] = city.sectorSeeds.map((s) => ({ id: s.id, name: s.name, segments: [], addresses: 0 }));
  const servedLen = new Float64Array(sectors.length);
  for (const s of n.segments) {
    const k = nearestSeed(midpoint(s));
    sectorOf[s.idx] = k;
    sectors[k].segments.push(s.idx);
    if (s.cls === "distribution" || s.cls === "maitresse") servedLen[k] += s.length;
  }
  sectors.forEach((s, k) => (s.addresses = Math.round(servedLen[k] / ADDRESS_M)));

  // distances depuis les sources ; nœuds non reliés ramenés à la distance maximale finie
  const dist = distancesFrom(n, n.sources);
  let maxD = 0;
  for (const d of dist) if (Number.isFinite(d) && d > maxD) maxD = d;
  for (let i = 0; i < dist.length; i++) if (!Number.isFinite(dist[i])) dist[i] = maxD;

  const at = (node: number): [number, number] => [pos[node * 2], pos[node * 2 + 1]];
  const sensors: Sensor[] = [];
  const add = (kind: SensorKind, prefix: string, k: number, node: number, sector = nearestSeed(at(node))) =>
    sensors.push({ idx: sensors.length, id: `${prefix}-${String(k).padStart(2, "0")}`, kind, node, at: at(node), sector: sectors[sector].id });

  // pression et débit : nœuds de maîtresses dans demoBox élargie de 50 % (25 % de chaque côté)
  const [w, so, e, no] = city.demoBox;
  const mx = (e - w) / 4;
  const my = (no - so) / 4;
  const candSet = new Set<number>();
  for (const s of n.segments) {
    if (s.cls !== "maitresse") continue;
    for (const node of [s.a, s.b]) {
      const [x, y] = at(node);
      if (x >= w - mx && x <= e + mx && y >= so - my && y <= no + my) candSet.add(node);
    }
  }
  const cand = [...candSet].sort((a, b) => a - b);
  const xy = new Float64Array(cand.length * 2);
  cand.forEach((node, i) => xy.set(proj(at(node)), i * 2));
  const sampler: Sampler = { cand, xy, proj: (node) => proj(at(node)) };
  // P-01 toujours au nœud de départ du tronçon du scénario (R2) ; un point sur quatre devient un débitmètre
  const first = n.segments[n.byId.get(city.breakSegment)!].a;
  const picked = [first, ...farthest(sampler, [first], N_PRESSURE + N_FLOW - 1)];
  const pNodes = picked.filter((_, i) => i % 4 !== 3);
  const dNodes = picked.filter((_, i) => i % 4 === 3);
  pNodes.forEach((node, i) => add("pression", "P", i + 1, node));
  dNodes.forEach((node, i) => add("debit", "D", i + 1, node));

  // qualité : une station par secteur, au nœud de distribution le plus proche de la graine
  sectors.forEach((sec, k) => {
    let best = -1;
    let bd = Infinity;
    for (const si of sec.segments) {
      const s = n.segments[si];
      if (s.cls !== "distribution") continue;
      const q = proj(at(s.a));
      const d = (q[0] - seeds[k][0]) ** 2 + (q[1] - seeds[k][1]) ** 2;
      if (d < bd) (bd = d), (best = s.a);
    }
    add("qualite", "Q", k + 1, best, k);
  });

  // réservoirs : une sonde de niveau par source RSV
  n.sources.filter((s) => n.nodes[s].includes("RSV")).forEach((node, i) => add("reservoir", "R", i + 1, node));

  const m: Model = { network: n, sectors, sensors, valves: placeValves(n), dist, sectorOf };
  samplerOf.set(m, sampler);
  return m;
}

/** Nœuds supplémentaires (banc de mesures, R7) : même échantillonnage, après les capteurs pression/débit. */
export function extraTagNodes(m: Model, n: number): number[] {
  const sampler = samplerOf.get(m);
  if (!sampler) throw new Error("modèle non construit par buildModel");
  const chosen = m.sensors.filter((s) => s.kind === "pression" || s.kind === "debit").map((s) => s.node);
  const used = new Set(m.sensors.map((s) => s.node));
  return farthest(sampler, chosen, n + used.size).filter((x) => !used.has(x)).slice(0, n);
}

// --- état de l'incident ---

interface IncidentState {
  /** effet du bris en cours (0 à 1) */
  ramp: number;
  /** distance (m) au tronçon brisé, par nœud */
  dBreak: Float64Array;
  /** segments à pression nulle (0) ou en remise en eau (0 à 1), sinon absents */
  isolated: Map<number, number>;
  isolatedNodes: Map<number, number>;
  /** turbidité ajoutée dans le secteur du bris */
  turbidity: number;
  sector: number;
}

function incidentState(m: Model, t: number, inc: IncidentInput | null): IncidentState | null {
  if (!inc || t < inc.startedAt) return null;
  const n = m.network;
  const seg = n.segments[inc.segment];
  const dBreak = cached(m, `bris:${inc.segment}`, () => distancesFrom(n, [seg.a, seg.b]));
  const iso = cached<Isolation>(m, `iso:${inc.segment}`, () => isolate(n, inc.segment, m.valves));
  // isolé seulement si toutes les vannes de la zone sont fermées
  const closed = new Set(inc.closedValves);
  const isClosed = iso.valves.length > 0 && iso.valves.every((v) => closed.has(v));
  const restored = inc.restoredAt !== null && t >= inc.restoredAt;
  const st: IncidentState = {
    ramp: restored || isClosed ? 0 : clamp((t - inc.startedAt) / BREAK_RAMP_MS, 0, 1),
    dBreak,
    isolated: new Map(),
    isolatedNodes: new Map(),
    turbidity: restored ? (TURB_PEAK - TURB_BASE) * Math.exp(-(t - inc.restoredAt!) / TURB_DECAY_MS) : 0,
    sector: m.sectorOf[inc.segment],
  };
  const level = restored ? clamp((t - inc.restoredAt!) / RESTORE_MS, 0, 1) : 0;
  if ((isClosed || restored) && level < 1) {
    for (const si of iso.isolated) st.isolated.set(si, level);
    // nœuds privés d'eau : tous leurs tronçons sont isolés (les vannes fermées gardent la pression amont)
    for (const si of iso.isolated) {
      const s = n.segments[si];
      for (const node of [s.a, s.b]) if (n.adj[node].every((x) => st.isolated.has(x))) st.isolatedNodes.set(node, level);
    }
  }
  return st;
}

// --- grandeurs physiques ---

function pressureAt(m: Model, node: number, d: number, minute: number, st: IncidentState | null): number {
  const base = clamp(P_MAX - (P_PER_KM * m.dist[node]) / 1000, P_MIN_BASE, P_MAX);
  let p = base - P_DEMAND * (d - 0.8) + P_NOISE * noise(node, minute, 1);
  if (st) {
    if (st.ramp > 0) p -= BREAK_DROP * st.ramp * Math.exp(-st.dBreak[node] / BREAK_DECAY_M);
    const lv = st.isolatedNodes.get(node);
    if (lv !== undefined) p *= lv;
  }
  return Math.max(0, p);
}

function chlorineAt(m: Model, node: number, minute: number): number {
  return CL_MAX * Math.exp(-m.dist[node] / CL_DECAY_M) + CL_NOISE * noise(node, minute, 2);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Débit nominal (L/s) d'une conduite de `diameterMm` à la demande relative d (vitesse 0,6 m/s à demande 1). */
export function nominalFlowLs(diameterMm: number, d: number): number {
  return MAIN_VELOCITY * Math.PI * (diameterMm / 2000) ** 2 * 1000 * d;
}

/** Lectures de tous les capteurs à l'instant t, indexées par `sensor.idx`. */
export function readingsAt(m: Model, tSim: number, inc: IncidentInput | null): Reading[] {
  const minute = Math.floor(tSim / 60_000);
  const h = localHour(tSim);
  const d = demand(h);
  const st = incidentState(m, tSim, inc);
  const n = m.network;
  return m.sensors.map((s): Reading => {
    if (s.kind === "pression") {
      const v = round2(pressureAt(m, s.node, d, minute, st));
      return { value: v, unit: "bar", status: v < THRESHOLDS.pressureMin ? "alerte" : v < 2.5 ? "attention" : "ok" };
    }
    if (s.kind === "debit") {
      // débit nominal selon le plus gros diamètre de maîtresse au nœud
      let dia = 0;
      for (const si of n.adj[s.node]) if (n.segments[si].cls === "maitresse") dia = Math.max(dia, n.segments[si].diameter);
      const expected = nominalFlowLs(dia, d);
      let q = expected * (1 + 0.02 * noise(s.node, minute, 3));
      if (st && st.ramp > 0) q *= 1 + 0.8 * st.ramp * Math.exp(-st.dBreak[s.node] / (2 * BREAK_DECAY_M));
      if (st?.isolatedNodes.has(s.node)) q *= st.isolatedNodes.get(s.node)!;
      const ratio = q / expected;
      return { value: round2(q), unit: "L/s", status: ratio > 1.25 || ratio < 0.5 ? "alerte" : ratio > 1.1 ? "attention" : "ok" };
    }
    if (s.kind === "qualite") {
      const cl = round2(chlorineAt(m, s.node, minute));
      const boost = st && m.sectors[st.sector].id === s.sector ? st.turbidity : 0;
      const turbidity = round2(TURB_BASE + boost + 0.02 * noise(s.node, minute, 4));
      const ph = round2(7.6 + 0.1 * noise(s.node, minute, 5));
      const temp = round2(6 + 0.2 * noise(s.node, minute, 6));
      const alert = cl < THRESHOLDS.chloreMin || cl > THRESHOLDS.chloreMax || turbidity > THRESHOLDS.turbidityMax || ph < THRESHOLDS.phMin || ph > THRESHOLDS.phMax;
      const warn = cl < 0.3 || turbidity > 0.5;
      return { value: cl, unit: "mg/L", status: alert ? "alerte" : warn ? "attention" : "ok", extra: { turbidity, ph, temp } };
    }
    // réservoir : se remplit la nuit, se vide pendant la journée
    const level = round2(72 + 14 * Math.cos((2 * Math.PI * (h - 5)) / 24) + 5 * noise(s.node, 0, 7) + 0.3 * noise(s.node, minute, 8));
    return { value: level, unit: "%", status: level < 30 ? "alerte" : level < 50 ? "attention" : "ok" };
  });
}

/** Valeur par segment pour colorer les conduites : pression (bar) ou chlore résiduel (mg/L). */
export function segmentValues(m: Model, tSim: number, inc: IncidentInput | null, layer: "pression" | "qualite"): Float32Array {
  const minute = Math.floor(tSim / 60_000);
  const d = demand(localHour(tSim));
  const st = layer === "pression" ? incidentState(m, tSim, inc) : null;
  const n = m.network;
  const node = new Float32Array(n.nodes.length);
  for (let i = 0; i < node.length; i++) node[i] = layer === "pression" ? pressureAt(m, i, d, minute, st) : chlorineAt(m, i, minute);
  const out = new Float32Array(n.segments.length);
  for (const s of n.segments) {
    const lv = st?.isolated.get(s.idx);
    out[s.idx] = lv === 0 ? 0 : (node[s.a] + node[s.b]) / 2;
  }
  return out;
}

/** Longueur desservie (distribution + maîtresse) d'un segment, en adresses. */
const addressLen = (m: Model, si: number) => {
  const c = m.network.segments[si].cls;
  return c === "distribution" || c === "maitresse" ? m.network.segments[si].length : 0;
};

/** Débit de secteur attendu (sans fuite) pour la demande d : longueur de distribution × 0,004 L/s/m × D. */
function expectedFlow(m: Model, k: number, d: number): number {
  const len = cached(m, "distribution", () =>
    m.sectors.map((sec) => sec.segments.reduce((a, si) => a + (m.network.segments[si].cls === "distribution" ? m.network.segments[si].length : 0), 0)),
  );
  return len[k] * FLOW_PER_M * d;
}

export function sectorStats(m: Model, tSim: number, inc: IncidentInput | null): SectorStat[] {
  const minute = Math.floor(tSim / 60_000);
  const h = localHour(tSim);
  const d = demand(h);
  const st = incidentState(m, tSim, inc);
  // dernière nuit à 3 h locale
  const t3 = tSim - (((h - 3 + 24) % 24) * HOUR);
  const minute3 = Math.floor(t3 / 60_000);
  return m.sectors.map((sec, k) => {
    const leak = sec.name === LEAK_SECTOR ? LEAK_NIGHT * expectedFlow(m, k, demand(3)) : 0;
    let dry = 0;
    let dryDistrib = 0;
    if (st)
      for (const [si, lv] of st.isolated) {
        if (m.sectorOf[si] !== k || lv > 0) continue;
        dry += addressLen(m, si);
        if (m.network.segments[si].cls === "distribution") dryDistrib += m.network.segments[si].length;
      }
    let flow = (expectedFlow(m, k, d) - dryDistrib * FLOW_PER_M * d + leak) * (1 + 0.01 * noise(k, minute, 9));
    if (st && st.sector === k) flow += BREAK_FLOW_LS * st.ramp;
    const night = (expectedFlow(m, k, demand(3)) + leak) * (1 + 0.01 * noise(k, minute3, 9));
    return {
      id: sec.id,
      served: sec.addresses - Math.round(dry / ADDRESS_M),
      flowLs: round2(flow),
      nightRatio: Math.round((night / expectedFlow(m, k, demand(3))) * 1000) / 1000,
    };
  });
}

/** Impact de l'incident en adresses (R9) : basse pression (< seuil) et sans eau (zone isolée). */
export function incidentImpact(m: Model, tSim: number, inc: IncidentInput | null): { lowPressureAddresses: number; withoutWaterAddresses: number } {
  const st = incidentState(m, tSim, inc);
  if (!st) return { lowPressureAddresses: 0, withoutWaterAddresses: 0 };
  const p = segmentValues(m, tSim, inc, "pression");
  let low = 0;
  let dry = 0;
  for (let si = 0; si < p.length; si++) {
    const len = addressLen(m, si);
    if (st.isolated.get(si) === 0) dry += len;
    else if (p[si] < THRESHOLDS.pressureMin) low += len;
  }
  return { lowPressureAddresses: Math.round(low / ADDRESS_M), withoutWaterAddresses: Math.round(dry / ADDRESS_M) };
}

const MATERIAL_RATE: Record<string, number> = {
  "fonte-grise": 1.9,
  "ciment-amiante": 0.6,
  "fonte-ductile": 0.25,
  autre: 0.3,
  pvc: 0.08,
  pehd: 0.08,
};

/** Bris antérieurs simulés depuis 2009 : taux du matériau × âge × longueur, arrondi par un hachage de l'id. */
export function breakHistory(m: Model, segment: number): number {
  const s = m.network.segments[segment];
  const age = clamp((2026 - (s.year ?? 1980)) / 50, 0.2, 2.5);
  const expected = MATERIAL_RATE[s.material] * age * (s.length / 100);
  let h = 0;
  for (let i = 0; i < s.id.length; i++) h = Math.imul(h ^ s.id.charCodeAt(i), 0x01000193);
  return Math.floor(expected + ((h >>> 0) % 1000) / 1000);
}

/** Campagne de rinçage simulée 2026 : un secteur par période de deux semaines, du 25 mai au 11 octobre. */
export const FLUSHING_2026: { sectorId: string; start: string; end: string }[] = CITY.sectorSeeds.map(({ id: sectorId }, k) => {
  const start = Date.UTC(2026, 4, 25) + k * 14 * 86_400_000;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { sectorId, start: day(start), end: day(start + 13 * 86_400_000) };
});
