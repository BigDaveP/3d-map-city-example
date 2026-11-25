import assert from "node:assert/strict";
import { test } from "node:test";
import { originTrialMeta } from "../src/lib/origin-trial";
import { ABOUT, DEMOS } from "../src/client/shell/demos";

const env = (o: Record<string, string> = {}) => ({ NODE_ENV: "test", ...o }) as NodeJS.ProcessEnv;

test("originTrialMeta : null sans jeton ou avec jeton vide", () => {
  assert.equal(originTrialMeta(env()), null);
  assert.equal(originTrialMeta(env({ HIC_ORIGIN_TRIAL_TOKEN: "  " })), null);
});

test("originTrialMeta : renvoie la méta avec le jeton", () => {
  assert.deepEqual(originTrialMeta(env({ HIC_ORIGIN_TRIAL_TOKEN: "abc" })), { httpEquiv: "origin-trial", content: "abc" });
});

test("DEMOS : quatre démos dans l'ordre, avec une phrase chacune", () => {
  assert.deepEqual(DEMOS.map((d) => d.href), ["/", "/mur", "/carte", "/bench"]);
  assert.ok(DEMOS[0].title.includes("Réseau d'eau"));
  for (const d of DEMOS) assert.ok(d.sentence.length > 10);
});

test("ABOUT : chaque démo a ce qu'on regarde, ce qui est simulé et 3 pistes", () => {
  for (const d of DEMOS) {
    const a = ABOUT[d.id];
    assert.ok(a.looking && a.simulated, d.id);
    assert.equal(a.tryIt.length, 3);
  }
});
