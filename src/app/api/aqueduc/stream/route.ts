/**
 * SSE par visiteur : un évènement `r` par seconde réelle.
 * ?t0=<ms sim>&speed=<1|60>&inc=<ms sim>&closed=<nœuds,>&restored=<ms sim>
 * Message : { t, r: [valeur, statut 0|1|2][], p, q (segments de demoBox, 2 décimales), s: SectorStat[] }
 * Le tronçon de l'incident est toujours CITY.breakSegment ; `inc` n'en porte que l'heure de début.
 * L'état de l'incident est reconstruit à chaque connexion depuis les paramètres : rien n'est mémorisé.
 */
import { CITY } from "@/lib/aqueduc/city";
import { readingsAt, sectorStats, segmentValues, type IncidentInput } from "@/lib/aqueduc/sim";
import { getDemoSegments, getModel } from "@/server/aqueduc";

export const dynamic = "force-dynamic";

const STATUS = { ok: 0, attention: 1, alerte: 2 } as const;
const r2 = (x: number) => Math.round(x * 100) / 100;

function num(v: string | null): number | null | undefined {
  if (v === null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const t0 = num(q.get("t0")) ?? Date.now();
  const speed = num(q.get("speed")) ?? 1;
  const inc = num(q.get("inc"));
  const restored = num(q.get("restored"));
  const m = getModel();
  const closed = (q.get("closed") ?? "").split(",").filter(Boolean).map(Number);
  if (t0 === undefined || (speed !== 1 && speed !== 60) || inc === undefined || restored === undefined || closed.some((v) => !Number.isInteger(v) || v < 0 || v >= m.network.nodes.length))
    return new Response("Paramètres invalides", { status: 400 });
  const incident: IncidentInput | null =
    inc === null ? null : { segment: m.network.byId.get(CITY.breakSegment)!, startedAt: inc, closedValves: closed, restoredAt: restored };
  const demo = getDemoSegments();
  const enc = new TextEncoder();
  const start = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => clearInterval(timer);
      const tick = () => {
        const t = Math.round(t0 + (Date.now() - start) * speed);
        const p = segmentValues(m, t, incident, "pression");
        const ql = segmentValues(m, t, incident, "qualite");
        const msg = {
          t,
          r: readingsAt(m, t, incident).map((x) => [x.value, STATUS[x.status]]),
          p: demo.map((si) => r2(p[si])),
          q: demo.map((si) => r2(ql[si])),
          s: sectorStats(m, t, incident),
        };
        try {
          controller.enqueue(enc.encode(`event: r\ndata: ${JSON.stringify(msg)}\n\n`));
        } catch {
          stop();
        }
      };
      controller.enqueue(enc.encode("retry: 1000\n\n"));
      tick();
      timer = setInterval(tick, 1000);
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
