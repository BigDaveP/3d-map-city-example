import type { Rect, WorldLayout } from "@/lib/world";

/** Indices des cartes qui intersectent `r` (balayage linéaire : 1 000 rectangles ≈ 10 µs). */
export function visibleCards(layout: WorldLayout, r: Rect, out: number[] = []): number[] {
  out.length = 0;
  const c = layout.cards;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  for (let i = 0, n = c.length / 4; i < n; i++) {
    const x = c[i * 4];
    const y = c[i * 4 + 1];
    if (x < x1 && x + c[i * 4 + 2] > r.x && y < y1 && y + c[i * 4 + 3] > r.y) out.push(i);
  }
  return out;
}

export const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
