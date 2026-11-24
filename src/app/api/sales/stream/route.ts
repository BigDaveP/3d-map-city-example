/**
 * Flux SSE des ventes : chaque succursale émet toutes les 1 à 5 s (divisé par la vitesse).
 * Les évènements dus sont regroupés par tranche de 50 ms (25 ms à x100) dans un seul message.
 */
import { getBranches } from "@/lib/sim/catalog";
import { SalesSimulator } from "@/lib/sim/generators";
import { readParams } from "@/server/params";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { n, speed, seed } = readParams(req);
  const branches = getBranches(n);
  const sim = new SalesSimulator(branches, speed, seed, Date.now());
  const enc = new TextEncoder();
  const step = speed >= 100 ? 25 : 50;
  let timer: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    clearInterval(timer);
    clearInterval(beat);
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
      send(`retry: 1000\nevent: hello\ndata: ${JSON.stringify({ n, speed, branches: branches.length })}\n\n`);
      timer = setInterval(() => {
        const now = Date.now();
        const events = sim.tick(now);
        if (events.length) send(`event: sales\ndata: ${JSON.stringify({ t: now, e: events })}\n\n`);
      }, step);
      beat = setInterval(() => send(`: ping\n\n`), 15_000);
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel: cleanup,
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
