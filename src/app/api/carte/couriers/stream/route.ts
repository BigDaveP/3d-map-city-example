/**
 * SSE : position de chaque livreur toutes les 1 à 2 s (intervalle propre à chaque livreur).
 * Message : { t, c: [[idx, lng, lat, heading, target, eta, order], …] }
 */
import { COURIERS, RESTAURANTS } from "@/lib/carte/catalog";
import { courierAt } from "@/lib/carte/sim";
import { listAssignments } from "@/server/carte-repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const enc = new TextEncoder();
  const next = new Float64Array(COURIERS.length);
  const now0 = Date.now();
  COURIERS.forEach((c, i) => (next[i] = now0 + Math.random() * 1000));
  let assign: Record<string, string> = await listAssignments();
  let timer: ReturnType<typeof setInterval> | undefined;
  let refresh: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    clearInterval(timer);
    clearInterval(refresh);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      send(`retry: 1000\n\n`);
      timer = setInterval(() => {
        const now = Date.now();
        const out: (number | string)[][] = [];
        COURIERS.forEach((c, i) => {
          if (next[i] > now) return;
          next[i] = now + 1000 + Math.random() * 1000;
          const a = assign[c.id];
          const p = courierAt(c, now, a ? RESTAURANTS.findIndex((r) => r.id === a) : undefined);
          out.push([i, +p.lng.toFixed(6), +p.lat.toFixed(6), Math.round(p.heading), p.target, p.eta, p.order]);
        });
        if (out.length) send(`event: couriers\ndata: ${JSON.stringify({ t: now, c: out })}\n\n`);
      }, 100);
      refresh = setInterval(async () => {
        assign = await listAssignments();
      }, 3000);
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel: cleanup,
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
