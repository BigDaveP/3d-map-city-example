import assert from "node:assert/strict";
import test from "node:test";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { atHour, type EnvAction } from "../src/lib/territoire/day";
import { snowPlan, type DeneigementData, type SnowSource } from "../src/lib/territoire/neige";
import { applySnowLayers, blink, removeSnowLayers, setLightStates, setSelectedZone, setZoneStates, type SnowMap } from "../src/client/territoire/modules/deneigement/layers";
import { banLine, decisionLine, lightsLabel, markFigure } from "../src/client/territoire/modules/deneigement/labels";
import { getDeneigementData } from "../src/server/territoire/deneigement";

const at = (h: string) => atHour(SCENARIO_DAY, h);
const sim: SnowSource = { kind: "simulation", cm: 12 };

/** Carte factice : sources et couches en mémoire, appels enregistrés. */
function fakeMap() {
  const sources = new Map<string, unknown>();
  const layers: { id: string; before?: string; spec: Record<string, unknown> }[] = [];
  const states: { target: { source: string; id: string | number }; state: Record<string, unknown> }[] = [];
  const paints: { layer: string; prop: string; value: unknown }[] = [];
  const map = {
    addSource: (id: string, spec: unknown) => void sources.set(id, spec),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (spec: { id: string }, before?: string) => void layers.push({ id: spec.id, before, spec }),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id), 1),
    setFeatureState: (target: { source: string; id: string | number }, state: Record<string, unknown>) => void states.push({ target, state }),
    setPaintProperty: (layer: string, prop: string, value: unknown) => void paints.push({ layer, prop, value }),
  } as unknown as SnowMap;
  return { map, sources, layers, states, paints };
}

const data: DeneigementData = getDeneigementData();

test("applySnowLayers : sources dn-zones et dn-lights (id promu), couches dn-zone-fill, dn-zone-line, dn-lights-halo, dn-lights", () => {
  const f = fakeMap();
  applySnowLayers(f.map, data);
  assert.deepEqual([...f.sources.keys()], ["dn-zones", "dn-lights"]);
  assert.deepEqual(f.layers.map((l) => l.id), ["dn-zone-fill", "dn-zone-line", "dn-lights-halo", "dn-lights"]);
  const zones = f.sources.get("dn-zones") as { promoteId: string; data: { features: unknown[] } };
  const lights = f.sources.get("dn-lights") as { promoteId: string; data: { features: unknown[] } };
  assert.equal(zones.promoteId, "id");
  assert.equal(zones.data.features.length, 3);
  assert.equal(lights.data.features.length, data.lights.length);
});

test("setZoneStates : un setFeatureState par zone, avec { ban }", () => {
  const f = fakeMap();
  const plans = snowPlan(at("08:30"), [{ at: at("08:00"), kind: "ban", zones: ["A", "B"] }], sim);
  setZoneStates(f.map, plans);
  assert.deepEqual(f.states, [
    { target: { source: "dn-zones", id: "A" }, state: { ban: "programmee" } },
    { target: { source: "dn-zones", id: "B" }, state: { ban: "programmee" } },
    { target: { source: "dn-zones", id: "C" }, state: { ban: "aucune" } },
  ]);
});

test("setLightStates : tous les feux d'une zone prennent l'état de sa zone, sans exception", () => {
  const f = fakeMap();
  applySnowLayers(f.map, data);
  const actions: EnvAction[] = [{ at: at("08:00"), kind: "ban", zones: ["A", "B"] }];
  setLightStates(f.map, snowPlan(at("23:30"), actions, sim));
  assert.equal(f.states.length, data.lights.length);
  const zoneOf = new Map(data.lights.map((l) => [l.id, l.zone]));
  for (const s of f.states) {
    assert.equal(s.target.source, "dn-lights");
    assert.equal(s.state.lights, zoneOf.get(String(s.target.id)) === "C" ? "eteint" : "allume", String(s.target.id));
  }
});

test("setSelectedZone : la zone choisie seule est sélectionnée", () => {
  const f = fakeMap();
  setSelectedZone(f.map, "B");
  assert.deepEqual(f.states.map((s) => [s.target.id, s.state.selected]), [["A", false], ["B", true], ["C", false]]);
});

test("blink : remplissage des feux allumés de 1 à 0,4 et halo suivant, les autres états intacts", () => {
  const f = fakeMap();
  applySnowLayers(f.map, data);
  blink(f.map, false);
  blink(f.map, true);
  const fill = f.paints.filter((p) => p.layer === "dn-lights" && p.prop === "circle-opacity").map((p) => p.value as unknown[]);
  const halo = f.paints.filter((p) => p.layer === "dn-lights-halo" && p.prop === "circle-opacity").map((p) => p.value as unknown[]);
  assert.equal(fill.length, 2);
  assert.equal(halo.length, 2);
  // ["case", <allumé>, valeur si allumé, autres]
  assert.deepEqual([fill[0][2], fill[0][3], fill[1][2]], [0.4, 1, 1]);
  assert.deepEqual([halo[0][2], halo[0][3], halo[1][2]], [0.2, 0, 0.55]);
  // l'anneau blanc des feux allumés ne clignote pas
  assert.equal(f.paints.some((p) => p.prop === "circle-stroke-opacity"), false);
});

test("feux : l'état allumé est le plus gros et cerclé de blanc ; ronds à l'écran malgré l'inclinaison", () => {
  const f = fakeMap();
  applySnowLayers(f.map, data);
  const paint = f.layers.find((l) => l.id === "dn-lights")!.spec.paint as Record<string, unknown[]>;
  assert.equal(paint["circle-pitch-alignment"] as unknown, "viewport");
  // rayon à 11,4 (vue d'ouverture) : ["match", état, "allume", r, "programme", r, r]
  const at114 = paint["circle-radius"][paint["circle-radius"].indexOf(11.4) + 1] as unknown[];
  const [lit, scheduled, off] = [at114[3], at114[5], at114[6]] as number[];
  assert.ok(lit >= 3.5 && lit > scheduled && scheduled > off, JSON.stringify(at114));
  assert.deepEqual(paint["circle-stroke-color"], ["match", ["coalesce", ["feature-state", "lights"], "eteint"], "programme", "#d98a12", "#ffffff"]);
});

test("removeSnowLayers : plus aucune couche ni source dn-*, et plus d'état des feux", () => {
  const f = fakeMap();
  applySnowLayers(f.map, data);
  removeSnowLayers(f.map);
  assert.equal(f.layers.length, 0);
  assert.equal(f.sources.size, 0);
  setLightStates(f.map, snowPlan(at("23:30"), [], sim));
  assert.equal(f.states.length, 0);
  // sans couche, blink ne touche à rien
  blink(f.map, true);
  assert.equal(f.paints.length, 0);
});

test("libellés : état, décision, seul chiffre du marquage, feux", () => {
  const [a, , c] = snowPlan(at("23:30"), [{ at: at("08:00"), kind: "ban", zones: ["A", "B"] }], sim);
  assert.equal(banLine(a), "Stationnement interdit · 23 h – 6 h");
  assert.equal(banLine(c), null);
  assert.equal(decisionLine(a), "Décidée par vous à 8 h 00");
  assert.equal(decisionLine(c), null);
  const direction = snowPlan(at("11:00"), [], sim)[0];
  assert.equal(banLine(direction), "Interdiction ce soir");
  assert.equal(decisionLine(direction), "Décidée à 10 h 00 par la direction (simulé)");
  assert.deepEqual(markFigure(direction, 102), { value: "102", label: "feux programmés" });
  assert.deepEqual(markFigure(c, 171), { value: "171", label: "feux éteints" });
  assert.deepEqual(markFigure(a, 102), { value: `${Math.round(a.progress * 100)}\u202f%`, label: "déneigé" });
  assert.equal(lightsLabel(102, "allume"), "102 feux allumés");
  assert.equal(lightsLabel(1, "programme"), "1 feu programmé");
  assert.equal(lightsLabel(0, "eteint"), "0 feu éteint");
});
