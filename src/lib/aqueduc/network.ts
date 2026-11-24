// Décodage du réseau d'aqueduc compact (data/aqueduc/trois-rivieres.json) en graphe.
export type Material = "fonte-grise" | "fonte-ductile" | "pvc" | "pehd" | "ciment-amiante" | "autre";
export type PipeClass = "amenee" | "maitresse" | "distribution" | "branchement";

export interface RawNetwork {
  v: 1;
  source: string;
  license: "CC-BY 4.0";
  extractedAt: string;
  nodes: string[];
  segs: [
    id: string,
    a: number,
    b: number,
    diameter: number,
    material: Material,
    year: number | null,
    cls: PipeClass,
    lengthM: number,
    coords: number[],
  ][];
}

export interface Segment {
  idx: number;
  id: string;
  a: number;
  b: number;
  diameter: number;
  material: Material;
  year: number | null;
  cls: PipeClass;
  length: number;
  /** lng, lat, lng, lat, … */
  coords: Float64Array;
}

export interface Network {
  nodes: string[];
  segments: Segment[];
  byId: Map<string, number>;
  /** nœud -> indices de segments */
  adj: number[][];
  /** nœuds réservoirs (RSV) ou « Rivière » */
  sources: number[];
}

export function decodeNetwork(raw: RawNetwork): Network {
  const adj: number[][] = raw.nodes.map(() => []);
  const byId = new Map<string, number>();
  const segments = raw.segs.map(([id, a, b, diameter, material, year, cls, length, coords], idx): Segment => {
    byId.set(id, idx);
    adj[a].push(idx);
    if (b !== a) adj[b].push(idx);
    return { idx, id, a, b, diameter, material, year, cls, length, coords: Float64Array.from(coords) };
  });
  const sources: number[] = [];
  raw.nodes.forEach((id, i) => {
    if (id.includes("RSV") || id === "Rivière") sources.push(i);
  });
  return { nodes: raw.nodes, segments, byId, adj, sources };
}

/** Indices des segments dont le milieu tombe dans [ouest, sud, est, nord]. */
export function segmentsInBox(n: Network, box: [number, number, number, number]): number[] {
  const [w, s, e, nn] = box;
  const out: number[] = [];
  for (const seg of n.segments) {
    const [x, y] = midpoint(seg);
    if (x >= w && x <= e && y >= s && y <= nn) out.push(seg.idx);
  }
  return out;
}

/** Point central d'un segment : milieu des deux sommets centraux de la polyligne. */
export function midpoint(s: Segment): [number, number] {
  const c = s.coords;
  const n = c.length / 2;
  const hi = Math.floor(n / 2);
  const lo = n % 2 === 0 ? hi - 1 : hi;
  return [(c[lo * 2] + c[hi * 2]) / 2, (c[lo * 2 + 1] + c[hi * 2 + 1]) / 2];
}
