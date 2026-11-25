import assert from "node:assert/strict";
import { test } from "node:test";
import { fold, staticHits } from "../src/lib/territoire/search";
import { FLEET } from "../src/lib/territoire/fleet";

test("fold : sans accents ni casse", () => {
  assert.equal(fold("  Sainte-Cécile "), "sainte-cecile");
});

test("staticHits : secteur de l'aqueduc, sans accents, avec son environnement", () => {
  const h = staticHits("cecile");
  assert.deepEqual(h.map((x) => x.focus), [{ env: "aqueduc", kind: "sector", id: "sainte-cecile" }]);
  assert.equal(h[0].label, "Sainte-Cécile");
  assert.match(h[0].kind, /Secteur/);
});

test("staticHits : zone de stationnement de nuit (« zone b » ou « B »)", () => {
  assert.deepEqual(staticHits("zone b").map((x) => x.focus), [{ env: "deneigement", kind: "zone", id: "B" }]);
  assert.deepEqual(staticHits("Zone").map((x) => x.focus.id), ["A", "B", "C"]);
});

test("staticHits : ressource de déneigement par identifiant ou par genre", () => {
  assert.deepEqual(staticHits("ch-0").map((x) => x.focus.id), FLEET.filter((r) => r.kind === "chenillette").map((r) => r.id));
  const so = staticHits("souffleuse");
  assert.equal(so.length, FLEET.filter((r) => r.kind === "souffleuse").length);
  assert.ok(so.every((x) => x.focus.env === "deneigement" && x.focus.kind === "resource"));
  assert.match(so[0].kind, /Souffleuse · Dépôt (Ouest|Est) \(simulé\)/);
});

test("staticHits : moins de deux caractères, rien", () => {
  assert.deepEqual(staticHits("c"), []);
  assert.deepEqual(staticHits("  "), []);
});
