import assert from "node:assert/strict";
import { test } from "node:test";
import { originTrialMeta } from "../src/lib/origin-trial";
import { ABOUT, otherPage, PAGES } from "../src/client/shell/demos";

const env = (o: Record<string, string> = {}) => ({ NODE_ENV: "test", ...o }) as NodeJS.ProcessEnv;

test("originTrialMeta : null sans jeton ou avec jeton vide", () => {
  assert.equal(originTrialMeta(env()), null);
  assert.equal(originTrialMeta(env({ HIC_ORIGIN_TRIAL_TOKEN: "  " })), null);
});

test("originTrialMeta : renvoie la méta avec le jeton", () => {
  assert.deepEqual(originTrialMeta(env({ HIC_ORIGIN_TRIAL_TOKEN: "abc" })), { httpEquiv: "origin-trial", content: "abc" });
});

test("PAGES : la démo à la racine et son banc ; chaque barre renvoie à l'autre page", () => {
  assert.deepEqual(Object.values(PAGES).map((d) => d.href), ["/", "/bench"]);
  assert.ok(PAGES.aqueduc.title.includes("Réseau d'eau"));
  assert.equal(otherPage("aqueduc"), "bench");
  assert.equal(otherPage("bench"), "aqueduc");
});

test("ABOUT : chaque page a ce qu'on regarde, ce qui est simulé et 3 pistes", () => {
  for (const id of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
    const a = ABOUT[id];
    assert.ok(a.looking && a.simulated, id);
    assert.equal(a.tryIt.length, 3);
  }
});
