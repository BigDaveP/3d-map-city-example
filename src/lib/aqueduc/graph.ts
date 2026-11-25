// Graphe du réseau : distances le long des conduites, vannes et isolation d'un tronçon.
import type { Network } from "./network";

/** Distance (m) le long des conduites depuis les nœuds donnés ; Infinity si non relié (Dijkstra, tas binaire). */
export function distancesFrom(n: Network, nodes: number[]): Float64Array {
  const dist = new Float64Array(n.nodes.length).fill(Infinity);
  // tas binaire de paires [distance, nœud]
  const heap: [number, number][] = [];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const s of nodes) {
    dist[s] = 0;
    push([0, s]);
  }
  while (heap.length > 0) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    for (const si of n.adj[u]) {
      const s = n.segments[si];
      const v = s.a === u ? s.b : s.a;
      const nd = d + s.length;
      if (nd < dist[v]) {
        dist[v] = nd;
        push([nd, v]);
      }
    }
  }
  return dist;
}

/** Hachage entier déterministe (FNV-1a) d'un identifiant de nœud. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Nœuds porteurs de vannes : degré ≥ 3 ; vanne systématique si au moins deux tronçons
 * sont des amenées ou des maîtresses, sinon environ un carrefour sur trois (hachage de l'id).
 */
export function placeValves(n: Network): Set<number> {
  const valves = new Set<number>();
  n.adj.forEach((segs, node) => {
    if (segs.length < 3) return;
    const mains = segs.filter((si) => n.segments[si].cls === "amenee" || n.segments[si].cls === "maitresse").length;
    if (mains >= 2 || hashId(n.nodes[node]) % 3 === 0) valves.add(node);
  });
  return valves;
}

export interface Isolation {
  segment: number;
  /** nœuds à fermer */
  valves: number[];
  /** segments privés d'eau */
  isolated: number[];
}

/** Isole un tronçon : parcours en largeur arrêté aux nœuds à vanne ; les branchements sont isolés sans propager. */
export function isolate(n: Network, segment: number, valves: Set<number>): Isolation {
  const isolated = new Set<number>([segment]);
  const closed = new Set<number>();
  const seen = new Set<number>();
  const queue: number[] = [];
  const visit = (node: number) => {
    if (seen.has(node)) return;
    seen.add(node);
    queue.push(node);
  };
  visit(n.segments[segment].a);
  visit(n.segments[segment].b);
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    if (valves.has(node)) {
      closed.add(node);
      continue;
    }
    for (const si of n.adj[node]) {
      isolated.add(si);
      const s = n.segments[si];
      if (s.cls === "branchement") continue;
      visit(s.a === node ? s.b : s.a);
    }
  }
  return {
    segment,
    valves: [...closed].sort((x, y) => x - y),
    isolated: [...isolated].sort((x, y) => x - y),
  };
}

/** Tracé d'une isolation à deux vannes, pour la coupe sous la rue. */
export interface IsolationPath {
  /** vanne de départ et d'arrivée (nœuds) */
  from: number;
  to: number;
  /** tronçons isolés de `from` à `to`, dans l'ordre (sans les branchements) */
  segments: number[];
  /** tronçon hors zone de l'autre côté de chaque vanne (le plus gros, amenée ou maîtresse d'abord) */
  before: number | null;
  after: number | null;
}

const MAIN_RANK = { amenee: 2, maitresse: 2, distribution: 1, branchement: 0 } as const;

/**
 * Chemin de vanne à vanne le long des tronçons isolés (parcours en largeur, branchements exclus) ;
 * null si l'isolation n'a pas exactement deux vannes ou si elles ne sont pas reliées.
 */
export function isolationPath(n: Network, iso: Isolation): IsolationPath | null {
  if (iso.valves.length !== 2) return null;
  const [from, to] = iso.valves;
  const inside = new Set(iso.isolated.filter((si) => n.segments[si].cls !== "branchement"));
  // parcours en largeur de `from` à `to` par les tronçons isolés
  const via = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let head = 0; head < queue.length && !via.has(to); head++) {
    const node = queue[head];
    if (node !== from && iso.valves.includes(node)) continue;
    for (const si of n.adj[node]) {
      if (!inside.has(si)) continue;
      const s = n.segments[si];
      const next = s.a === node ? s.b : s.a;
      if (via.has(next)) continue;
      via.set(next, si);
      queue.push(next);
    }
  }
  if (!via.has(to)) return null;
  const segments: number[] = [];
  for (let node = to; node !== from; ) {
    const si = via.get(node)!;
    segments.unshift(si);
    const s = n.segments[si];
    node = s.a === node ? s.b : s.a;
  }
  const outside = (valve: number): number | null => {
    let best: number | null = null;
    for (const si of n.adj[valve]) {
      const s = n.segments[si];
      if (iso.isolated.includes(si) || s.cls === "branchement") continue;
      const b = best === null ? null : n.segments[best];
      if (!b || MAIN_RANK[s.cls] > MAIN_RANK[b.cls] || (MAIN_RANK[s.cls] === MAIN_RANK[b.cls] && s.diameter > b.diameter)) best = si;
    }
    return best;
  };
  return { from, to, segments, before: outside(from), after: outside(to) };
}
