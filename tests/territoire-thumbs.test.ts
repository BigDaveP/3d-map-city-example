import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { ENVS, type EnvId } from "../src/lib/territoire/envs";
import { LIGHTS_TOTAL, SEGMENTS_TOTAL, THUMBS } from "../src/lib/territoire/thumbs";

test("vignettes : une par environnement, fichier WebP de public/territoire sous 120 Ko, texte de remplacement", () => {
  for (const id of Object.keys(ENVS) as EnvId[]) {
    const t = THUMBS[id];
    assert.match(t.src, /^\/territoire\/mini-[a-z]+\.webp$/);
    const file = new URL(`../public${t.src}`, import.meta.url);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "RIFF", `${id} : pas un fichier RIFF`);
    assert.equal(bytes.subarray(8, 12).toString("latin1"), "WEBP", `${id} : pas du WebP`);
    assert.ok(statSync(file).size < 120 * 1024, `${id} : ${statSync(file).size} octets`);
    assert.ok(t.alt.length > 10);
    // lot 1 : une légende d'un chiffre ; lot 2 : « À venir » est dans la carte, pas de légende
    assert.equal(t.caption !== null, ENVS[id].lot === 1, id);
  }
});

test("vignettes : les chiffres des légendes sont ceux des données", () => {
  const lights = (JSON.parse(readFileSync("data/territoire/feux.json", "utf8")) as { lights: unknown[] }).lights.length;
  const segs = (JSON.parse(readFileSync("data/aqueduc/trois-rivieres.json", "utf8")) as { segs: unknown[] }).segs.length;
  assert.equal(LIGHTS_TOTAL, lights);
  assert.equal(SEGMENTS_TOTAL, segs);
  assert.match(THUMBS.deneigement.caption!, /427 feux allumés/);
  assert.match(THUMBS.aqueduc.caption!, /24 137 tronçons|24 137 tronçons/);
});
