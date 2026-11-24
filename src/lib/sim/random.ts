/** Générateurs pseudo-aléatoires déterministes (partagés client / serveur). */

/** Hash entier 32 bits (FNV-1a + avalanche) d'une suite de nombres ou chaînes. */
export function hash(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = typeof p === "number" ? String(p) : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Nombre déterministe dans [0, 1) dérivé des parties fournies. */
export function rand01(...parts: (number | string)[]): number {
  return hash(...parts) / 4294967296;
}

/** PRNG séquentiel (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(arr: readonly T[], r: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
