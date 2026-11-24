import { normalizeCardCount } from "@/lib/sim/types";

export function readParams(req: Request) {
  const u = new URL(req.url);
  const n = normalizeCardCount(u.searchParams.get("n") ?? 1000);
  const speedRaw = Number(u.searchParams.get("speed") ?? 1);
  const speed = [1, 10, 100].includes(speedRaw) ? speedRaw : 1;
  const tick = Math.max(0, Math.min(1_000_000, Math.floor(Number(u.searchParams.get("tick") ?? 0)) || 0));
  const seed = Math.floor(Number(u.searchParams.get("seed") ?? 1)) >>> 0;
  return { n, speed, tick, seed };
}

export const json = (data: unknown, init?: ResponseInit) =>
  Response.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
