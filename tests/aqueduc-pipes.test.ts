import assert from "node:assert/strict";
import { test } from "node:test";
import { createPropertyExpression, latest } from "@maplibre/maplibre-gl-style-spec";
import { NO_DATA, PIPE_STOPS, pipeColor } from "../src/client/aqueduc/pipes";
import { seek, setSpeed, simNow, territoireStore } from "../src/client/territoire/store";
import { dayStart, sectorStatus } from "../src/client/aqueduc/format";
import { FLUSHING_2026, localHour } from "../src/lib/aqueduc/sim";

/** Évalue une expression de couleur de ligne comme MapLibre, pour une propriété et un état de feature. */
function colorOf(expr: unknown, properties: Record<string, unknown> = {}, state: Record<string, unknown> = {}): string {
  const spec = (latest as unknown as { paint_line: Record<string, unknown> }).paint_line["line-color"];
  const e = createPropertyExpression(expr, "line-color", spec as never);
  if (e.result !== "success") throw new Error(e.value.map((x) => `${x.key} ${x.message}`).join("; "));
  const c = (e.value as unknown as { evaluate: (...a: unknown[]) => { r: number; g: number; b: number } }).evaluate({ zoom: 15 }, { type: 2, properties }, state);
  const h = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

test("pipeColor(pression) : interpole les paliers de la décision R12", () => {
  const e = pipeColor("pression");
  assert.equal(colorOf(e, {}, { p: 1.2 }), "#d6402f");
  assert.equal(colorOf(e, {}, { p: 2.6 }), "#e8a33a");
  assert.equal(colorOf(e, {}, { p: 4.0 }), "#2f9bd6");
  assert.equal(colorOf(e, {}, { p: 5.2 }), "#1f5fa8");
  // réseau sain : 4,4 et 4,9 bar donnent deux bleus distincts (variation avec la distance aux sources)
  assert.notEqual(colorOf(e, {}, { p: 4.4 }), colorOf(e, {}, { p: 4.9 }));
  // entre deux paliers : mélange ; hors zone suivie (pas d'état) : gris neutre
  const mid = colorOf(e, {}, { p: 3.3 });
  assert.notEqual(mid, "#e8a33a");
  assert.notEqual(mid, "#2f9bd6");
  assert.equal(colorOf(e, {}, {}), NO_DATA);
  // pression nulle (tronçon isolé) : couleur du palier le plus bas
  assert.equal(colorOf(e, {}, { p: 0 }), "#d6402f");
});

test("pipeColor(age) : 1920 et 2014 ont des couleurs distinctes, année inconnue en gris", () => {
  const e = pipeColor("age");
  const old = colorOf(e, { y: 1920 });
  const recent = colorOf(e, { y: 2014 });
  assert.notEqual(old, recent);
  assert.equal(colorOf(e, { y: null }), NO_DATA);
});

test("pipeColor : chaque couche produit une expression valide et suit PIPE_STOPS", () => {
  assert.equal(colorOf(pipeColor("qualite"), {}, { q: PIPE_STOPS.qualite.stops[0][0] }), PIPE_STOPS.qualite.stops[0][1]);
  // rinçage : la couleur dépend de la période du secteur
  const r = pipeColor("rincage");
  assert.equal(colorOf(r, { s: FLUSHING_2026[0].sectorId }), PIPE_STOPS.rincage.stops[0][1]);
  assert.notEqual(colorOf(r, { s: FLUSHING_2026[0].sectorId }), colorOf(r, { s: FLUSHING_2026[9].sectorId }));
  // incidents : bris antérieurs, et le tronçon de l'incident en cours passe en rouge
  const i = pipeColor("incidents");
  assert.notEqual(colorOf(i, { b: 0 }), colorOf(i, { b: 3 }));
  assert.equal(colorOf(i, { b: 0 }, { inc: true }), "#d23b2b");
});

test("simNow : à ×60, l'horloge simulée avance de 60 s par seconde réelle", () => {
  const t0 = Date.UTC(2026, 10, 24, 12, 42);
  territoireStore.setState({ clock: { t0, speed: 60, startedAt: 1_000_000 } });
  assert.equal(simNow(1_000_000), t0);
  assert.equal(simNow(1_001_000), t0 + 60_000);
  assert.equal(simNow(1_010_000), t0 + 600_000);
  territoireStore.setState({ clock: { t0, speed: 1, startedAt: 1_000_000 } });
  assert.equal(simNow(1_001_000), t0 + 1000);
});

test("setSpeed et seek : repartent de l'heure simulée courante, sans saut", () => {
  const t0 = Date.UTC(2026, 10, 24, 12, 0);
  territoireStore.setState({ clock: { t0, speed: 1, startedAt: 2_000_000 } });
  setSpeed(60, 2_010_000);
  assert.deepEqual(territoireStore.getState().clock, { t0: t0 + 10_000, speed: 60, startedAt: 2_010_000 });
  assert.equal(simNow(2_011_000), t0 + 70_000);
  seek(t0 - 3_600_000, 2_020_000);
  assert.equal(simNow(2_020_000), t0 - 3_600_000);
  assert.equal(territoireStore.getState().clock.speed, 60);
});

test("dayStart : minuit local de la journée simulée", () => {
  const t = Date.UTC(2026, 10, 24, 12, 42, 17);
  const d = dayStart(t);
  assert.equal(localHour(d), 0);
  assert.ok(t - d < 86_400_000 && t >= d);
});

test("sectorStatus : alerte d'abord, puis débit de nuit élevé, sinon normal", () => {
  assert.equal(sectorStatus({ nightRatio: 1.0 }, 1).level, 2);
  assert.equal(sectorStatus({ nightRatio: 1.18 }, 0).level, 1);
  assert.match(sectorStatus({ nightRatio: 1.18 }, 0).label, /nuit/);
  assert.equal(sectorStatus({ nightRatio: 1.0 }, 0).level, 0);
});

test("applyPipeLayers : couches valides selon la spécification de style, conduites sous les bâtiments", async () => {
  const { validateStyleMin } = await import("@maplibre/maplibre-gl-style-spec");
  const { applyPipeLayers } = await import("../src/client/aqueduc/pipes");
  const sources: Record<string, unknown> = { openmaptiles: { type: "vector", url: "https://example.org/tiles" } };
  const layers: { id: string }[] = [{ id: "building-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building" } as never];
  const map = {
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addSource: (id: string, s: unknown) => void (sources[id] = s),
    addLayer: (l: { id: string }, before?: string) => {
      const k = before ? layers.findIndex((x) => x.id === before) : -1;
      layers.splice(k < 0 ? layers.length : k, 0, l);
    },
  };
  const data = {
    segments: { type: "FeatureCollection", features: [] },
    sensors: [],
    sectors: [{ id: "centre-ville", name: "Centre-ville", addresses: 2417, at: [-72.54, 46.34] }],
    valves: [],
    attribution: "",
    demoSegments: [],
  };
  applyPipeLayers(map as never, data as never, "pression");
  const errors = validateStyleMin({ version: 8, glyphs: "https://example.org/{fontstack}/{range}.pbf", sources, layers } as never);
  assert.deepEqual(errors.map((e: { message: string }) => e.message), []);
  const ids = layers.map((l) => l.id);
  assert.ok(ids.indexOf("aq-pipes-casing") < ids.indexOf("aq-pipes") && ids.indexOf("aq-pipes") < ids.indexOf("building-3d"));
});

test("removePipeLayers : retire les couches et les sources de l'aqueduc, sans toucher au fond", async () => {
  const { applyPipeLayers, removePipeLayers } = await import("../src/client/aqueduc/pipes");
  const sources = new Map<string, unknown>([["openmaptiles", {}]]);
  const layers: { id: string }[] = [{ id: "building-3d" }];
  const map = {
    getLayer: (id: string) => layers.find((l) => l.id === id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: unknown) => void sources.set(id, s),
    removeSource: (id: string) => {
      assert.ok(!layers.some((l) => (l as { source?: string }).source === id), `source ${id} encore utilisée`);
      sources.delete(id);
    },
    addLayer: (l: { id: string }) => void layers.push(l),
    removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id), 1),
  };
  const data = { segments: { type: "FeatureCollection", features: [] }, sensors: [], sectors: [], valves: [], attribution: "", demoSegments: [] };
  applyPipeLayers(map as never, data as never, "pression");
  assert.ok(layers.length > 1 && sources.size > 1);
  removePipeLayers(map as never);
  assert.deepEqual(layers.map((l) => l.id), ["building-3d"]);
  assert.deepEqual([...sources.keys()], ["openmaptiles"]);
  // deux fois : sans erreur (démontage après un échec de chargement)
  removePipeLayers(map as never);
});
