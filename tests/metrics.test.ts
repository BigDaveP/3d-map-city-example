import assert from "node:assert/strict";
import { test } from "node:test";
import { Metrics } from "../src/client/metrics";

const busy = (ms: number) => {
  const t = performance.now();
  while (performance.now() - t < ms);
};

test("Metrics : mises à jour comptées à part et une seule fois dans le travail de frame", () => {
  const m = new Metrics();
  m.beginPhase("x");
  m.frameStart(1000);
  m.beginUpdate();
  // travail interne déjà signalé (abonné au store) : il n'est pas compté deux fois
  m.addWork(2);
  busy(5);
  m.endUpdate();
  const frameWork = m.pendingWork();
  m.frameEnd(frameWork);
  m.update(3);
  const r = m.endPhase()!;
  assert.ok(frameWork >= 5 && frameWork < 7 + 2, `travail de frame ${frameWork}`);
  assert.equal(r.updates, 2);
  assert.ok(r.updMax >= 5, `updMax ${r.updMax}`);
  assert.ok(r.workMax >= 5);
  assert.ok(r.updMsPerSec > 0);
  const s = m.snapshot();
  assert.ok(s.updP95 >= 3 && s.updMsPerSec > 0);
});

test("Metrics : un travail commencé pendant une mise à jour mesurée n'est pas compté deux fois", () => {
  const m = new Metrics();
  m.beginPhase("x");
  m.beginUpdate();
  const inside = performance.now();
  busy(3);
  m.endUpdate();
  // lot d'étiquettes rendu pendant le message (microtâche passée après endUpdate)
  m.update(2, inside);
  // lot ultérieur (minuterie) : compté
  busy(1);
  m.update(4, performance.now());
  const r = m.endPhase()!;
  assert.equal(r.updates, 2);
  assert.ok(r.updMax >= 3 && r.updMax < 5);
});
