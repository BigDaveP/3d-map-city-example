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
