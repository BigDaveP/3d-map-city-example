import assert from "node:assert/strict";
import { test } from "node:test";
import { BinaryHeap, RecaptureScheduler, type ScheduleInput } from "../src/client/hic/scheduler";

const input = (over: Partial<ScheduleInput>, tex: Map<number, number>, ver: Map<number, number>, since: Map<number, number>, log: number[]): ScheduleInput => ({
  levelOf: () => 2,
  candidates: [...new Set([...tex.keys(), ...ver.keys()])],
  focused: -1,
  textureVersion: (c) => tex.get(c) ?? -1,
  contentVersion: (c) => ver.get(c) ?? 0,
  since: (c) => since.get(c) ?? 0,
  maxCaptures: 100,
  maxMs: 1000,
  capture: (c) => {
    log.push(c);
    return true;
  },
  ...over,
});

test("tas binaire : priorité puis ancienneté", () => {
  const h = new BinaryHeap();
  [{ card: 1, prio: 2, since: 5 }, { card: 2, prio: 1, since: 9 }, { card: 3, prio: 2, since: 1 }, { card: 4, prio: 0, since: 99 }].forEach((c) => h.push(c));
  assert.deepEqual([h.pop()!.card, h.pop()!.card, h.pop()!.card, h.pop()!.card], [4, 2, 3, 1]);
});

test("manquantes avant périmées, propres ignorées", () => {
  const log: number[] = [];
  // 1 : à jour ; 2 : périmée ; 3 : manquante
  const tex = new Map([[1, 5], [2, 1]]);
  const ver = new Map([[1, 5], [2, 3], [3, 0]]);
  const r = new RecaptureScheduler().run(input({}, tex, ver, new Map(), log));
  assert.deepEqual(log, [3, 2]);
  assert.equal(r.remaining, 0);
});

test("budget en nombre de captures, file restante, focus prioritaire hors budget", () => {
  const log: number[] = [];
  const tex = new Map<number, number>();
  const ver = new Map<number, number>();
  for (let c = 0; c < 10; c++) ver.set(c, 1);
  const since = new Map([[7, 100]]);
  const r = new RecaptureScheduler().run(input({ maxCaptures: 3, focused: 7 }, tex, ver, since, log));
  assert.equal(log[0], 7, "la carte focalisée passe en premier");
  assert.equal(r.captured, 3);
  assert.equal(r.remaining, 7);
});

test("rapprochées (épinglées) avant intermédiaires", () => {
  const log: number[] = [];
  const ver = new Map([[1, 1], [2, 1], [3, 1]]);
  new RecaptureScheduler().run(input({ levelOf: (c) => (c === 3 ? 2 : 1) }, new Map(), ver, new Map([[1, 1], [2, 2], [3, 50]]), log));
  assert.deepEqual(log, [3, 1, 2]);
});

test("la carte focalisée est capturée même budget épuisé", () => {
  const log: number[] = [];
  const ver = new Map([[1, 1], [2, 1]]);
  const r = new RecaptureScheduler().run(input({ maxCaptures: 0, focused: 2 }, new Map(), ver, new Map(), log));
  assert.deepEqual(log, [2]);
  assert.equal(r.forced, 1);
  assert.equal(r.remaining, 1);
});
