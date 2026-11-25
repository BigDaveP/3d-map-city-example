import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as getNetwork } from "../src/app/api/aqueduc/network/route";
import { GET as getStream } from "../src/app/api/aqueduc/stream/route";
import { closeValvesAction, publishNoticeAction } from "../src/app/aqueduc-actions";
import { CITY } from "../src/lib/aqueduc/city";
import { isolate } from "../src/lib/aqueduc/graph";
import { breakHistory } from "../src/lib/aqueduc/sim";
import { segmentsInBox } from "../src/lib/aqueduc/network";
import { EXTRA_TAGS_MAX } from "../src/lib/aqueduc/city";
import { getExtraTagNodes, getModel } from "../src/server/aqueduc";

const T0 = Date.UTC(2026, 10, 24, 15, 15);

/** Ouvre le flux, lit le premier évènement `r` (ou les n premiers), puis coupe. */
async function firstEvents(query: string, count = 1): Promise<{ events: any[]; ms: number }> {
  const ac = new AbortController();
  const res = await getStream(new Request(`http://x/api/aqueduc/stream?${query}`, { signal: ac.signal }));
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const events: any[] = [];
  let buf = "";
  const t = performance.now();
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let k: number;
    while ((k = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, k);
      buf = buf.slice(k + 2);
      const m = /^event: r\ndata: (.*)$/m.exec(block);
      if (m) events.push(JSON.parse(m[1]));
    }
  }
  const ms = performance.now() - t;
  ac.abort();
  return { events, ms };
}

test("le flux envoie un premier évènement r avec t ≈ t0", async () => {
  const m = getModel();
  const { events } = await firstEvents(`t0=${T0}&speed=1`);
  const e = events[0];
  assert.ok(Math.abs(e.t - T0) < 2000, `t=${e.t}`);
  assert.equal(e.r.length, m.sensors.length);
  assert.equal(e.p.length, segmentsInBox(m.network, CITY.demoBox).length);
  assert.equal(e.q.length, e.p.length);
  assert.equal(e.s.length, m.sectors.length);
  assert.ok(e.r.every(([v, st]: number[]) => Number.isFinite(v) && [0, 1, 2].includes(st)));
});

test("reconnexion : même t0 et même instant → mêmes lectures", async () => {
  const q = `t0=${T0}&speed=1&inc=${T0 - 3_600_000}&closed=`;
  const a = (await firstEvents(q)).events[0];
  const b = (await firstEvents(q)).events[0];
  assert.deepEqual(a.r, b.r);
  assert.deepEqual(a.p, b.p);
  assert.deepEqual(a.q, b.q);
});

test("speed=60 : t avance de ~60 s par seconde réelle", async () => {
  const { events, ms } = await firstEvents(`t0=${T0}&speed=60`, 2);
  const dt = events[1].t - events[0].t;
  assert.ok(dt > 50_000 && dt < 75_000, `dt=${dt} après ${ms} ms`);
});

test("l'incident du flux abaisse la pression au capteur P-01, vannes fermées comprises", async () => {
  const m = getModel();
  const i = m.sensors.findIndex((s) => s.id === "P-01");
  const base = (await firstEvents(`t0=${T0}&speed=1`)).events[0].r[i][0];
  const brk = m.network.byId.get(CITY.breakSegment)!;
  const valves = isolate(m.network, brk, m.valves).valves;
  const inc = (await firstEvents(`t0=${T0}&speed=1&inc=${T0 - 600_000}&closed=`)).events[0].r[i][0];
  assert.ok(inc < base * 0.4, `${inc} vs ${base}`);
  const closed = (await firstEvents(`t0=${T0}&speed=1&inc=${T0 - 600_000}&closed=${valves.join(",")}`)).events[0];
  assert.ok(Array.isArray(closed.r));
});

test("paramètres invalides : 400", async () => {
  const res = await getStream(new Request("http://x/api/aqueduc/stream?speed=7"));
  assert.equal(res.status, 400);
});

test("closeValvesAction refuse une vanne étrangère et accepte deux fois la même demande", async () => {
  const m = getModel();
  const iso = isolate(m.network, m.network.byId.get(CITY.breakSegment)!, m.valves);
  const foreign = [...m.valves].find((v) => !iso.valves.includes(v))!;
  const bad = await closeValvesAction(CITY.breakSegment, [iso.valves[0], foreign]);
  assert.equal(bad.ok, false);
  const a = await closeValvesAction(CITY.breakSegment, iso.valves);
  const b = await closeValvesAction(CITY.breakSegment, iso.valves);
  assert.equal(a.ok, true);
  assert.deepEqual(a, b);
  if (a.ok) assert.deepEqual(a.isolation, iso);
  assert.equal((await closeValvesAction("n'existe-pas", [])).ok, false);
});

test("closeValvesAction refuse une liste qui n'est pas exactement le plan d'isolation", async () => {
  const m = getModel();
  const iso = isolate(m.network, m.network.byId.get(CITY.breakSegment)!, m.valves);
  const reason = async (seg: unknown, nodes: unknown) => {
    const r = await closeValvesAction(seg, nodes);
    assert.equal(r.ok, false, JSON.stringify(nodes));
    return r.ok ? "" : r.reason;
  };
  assert.match(await reason(CITY.breakSegment, "1,2"), /liste de nœuds/);
  assert.match(await reason(CITY.breakSegment, null), /liste de nœuds/);
  assert.match(await reason(CITY.breakSegment, [iso.valves[0], 1.5]), /non entiers \(1\.5\)/);
  assert.match(await reason(CITY.breakSegment, [...iso.valves, "3"]), /non entiers/);
  assert.match(await reason(CITY.breakSegment, []), /Isolement incomplet/);
  assert.match(await reason(CITY.breakSegment, [iso.valves[0]]), /Isolement incomplet/);
  assert.match(await reason(42, iso.valves), /Tronçon invalide/);
  // ordre et doublons indifférents : c'est l'ensemble qui compte
  const r = await closeValvesAction(CITY.breakSegment, [...iso.valves].reverse().concat(iso.valves[0]));
  assert.equal(r.ok, true);
});

test("publishNoticeAction est idempotente", async () => {
  const a = await publishNoticeAction("centre-ville", "ebullition");
  const b = await publishNoticeAction("centre-ville", "ebullition");
  assert.deepEqual(a, b);
  assert.equal(a.notice.sectorId, "centre-ville");
  assert.equal(a.notice.kind, "ebullition");
  assert.ok(a.notice.addresses > 0);
  assert.match(a.notice.text, /Simulation/);
  const c = await publishNoticeAction("centre-ville", "interruption");
  assert.notEqual(c.notice.text, a.notice.text);
});

test("network : 13C1949 présent, attribution exacte, demoSegments aligné", async () => {
  const res = await getNetwork();
  assert.equal(res.headers.get("cache-control"), "public, max-age=86400");
  const j = await res.json();
  assert.equal(j.attribution, CITY.attribution);
  const f = j.segments.features.find((x: any) => x.properties.id === "13C1949");
  assert.ok(f);
  assert.equal(f.geometry.type, "LineString");
  // l : longueur (m) de la donnée source ; b : bris antérieurs simulés (même calcul que breakHistory)
  assert.deepEqual(Object.keys(f.properties).sort(), ["b", "c", "d", "i", "id", "l", "m", "s", "y"]);
  const m = getModel();
  assert.equal(f.properties.l, 69.9);
  assert.equal(f.properties.b, breakHistory(m, f.properties.i));
  assert.equal(j.segments.features.length, m.network.segments.length);
  assert.deepEqual(j.demoSegments, segmentsInBox(m.network, CITY.demoBox));
  assert.equal(j.sensors.length, m.sensors.length);
  assert.equal(j.sectors.length, m.sectors.length);
  assert.equal(j.valves.length, m.valves.size);
});

test("banc (R7) : points supplémentaires dans le réseau et, sur demande, dans le flux", async () => {
  const j = await (await getNetwork()).json();
  assert.equal(j.extraTags.length, EXTRA_TAGS_MAX);
  assert.equal(j.extraTags[0].id, "X-001");
  assert.deepEqual(j.extraTags.map((x: any) => x.node), getExtraTagNodes());
  const plain = (await firstEvents(`t0=${T0}&speed=1`)).events[0];
  assert.equal(plain.x, undefined);
  const e = (await firstEvents(`t0=${T0}&speed=1&extra=30`)).events[0];
  assert.equal(e.x.length, 30);
  assert.ok(e.x.every(([v, st]: number[]) => Number.isFinite(v) && [0, 1, 2].includes(st)));
  for (const bad of ["-1", "1.5", "abc", String(EXTRA_TAGS_MAX + 1)]) {
    const res = await getStream(new Request(`http://x/api/aqueduc/stream?t0=${T0}&speed=1&extra=${bad}`));
    assert.equal(res.status, 400, `extra=${bad}`);
  }
});
