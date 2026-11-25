/** Géométrie plane pour les zones : point dans un polygone et distance au sol. Module pur. */

/** Anneaux GeoJSON [lng, lat] : le premier est le contour, les suivants sont des trous. */
export type Polygon = [number, number][][];

/** Vrai si le point est dans le polygone (règle pair-impair, trous compris). */
export function pointInPolygon([x, y]: [number, number], polygon: Polygon): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distance approchée en mètres entre deux points [lng, lat] (plan local, juste à cette échelle). */
export function distanceM(a: [number, number], b: [number, number]): number {
  const k = 111_320;
  const dx = (a[0] - b[0]) * k * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = (a[1] - b[1]) * k;
  return Math.hypot(dx, dy);
}

/** Distance (m) du point au segment [a, b] (plan local). */
function segmentDistanceM(p: [number, number], a: [number, number], b: [number, number]): number {
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 111_320;
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const u = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
  return Math.hypot(ax + u * dx, ay + u * dy);
}

/** Distance (m) du point au bord le plus proche du polygone (contour et trous). */
function edgeDistanceM(p: [number, number], polygon: Polygon): number {
  let d = Infinity;
  for (const ring of polygon) for (let i = 1; i < ring.length; i++) d = Math.min(d, segmentDistanceM(p, ring[i - 1], ring[i]));
  return d;
}

/**
 * Point où poser l'étiquette d'une zone : à l'intérieur, le plus loin possible des bords (pôle
 * d'inaccessibilité approché par deux grilles, la seconde resserrée autour du meilleur point). Le
 * centre de gravité d'une zone en croissant ou en bande peut tomber dehors ; celui-ci, jamais.
 */
export function labelPoint(polygon: Polygon, n = 32): [number, number] {
  const outer = polygon[0];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of outer) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  let best: [number, number] = outer[0];
  let bestD = -1;
  const scan = (cx0: number, cy0: number, cx1: number, cy1: number) => {
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const p: [number, number] = [cx0 + ((cx1 - cx0) * i) / n, cy0 + ((cy1 - cy0) * j) / n];
        if (!pointInPolygon(p, polygon)) continue;
        const d = edgeDistanceM(p, polygon);
        if (d > bestD) [best, bestD] = [p, d];
      }
  };
  scan(x0, y0, x1, y1);
  const hx = (x1 - x0) / n;
  const hy = (y1 - y0) / n;
  scan(best[0] - hx, best[1] - hy, best[0] + hx, best[1] + hy);
  return best;
}
