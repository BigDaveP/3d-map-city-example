/** Export vidéo : détection des API d'enregistrement, refus d'un fichier vide (R19), bandeau de crédits. */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CARTE_VIDEO_CREDITS } from "../src/lib/carte/catalog";
import { canRecord, creditFontPx, drawCredits, recordMap, stripHeight, wrapCredits } from "../src/client/aqueduc/video";
import { CITY, VIDEO_CREDITS } from "../src/lib/aqueduc/city";

const g = globalThis as Record<string, unknown>;
const saved = { MediaRecorder: g.MediaRecorder, HTMLCanvasElement: g.HTMLCanvasElement, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame, document: g.document };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

class FakeRecorder {
  static isTypeSupported = () => true;
  static chunk = 0;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {}
  stop() {
    if (FakeRecorder.chunk) this.ondataavailable?.({ data: new Blob([new Uint8Array(FakeRecorder.chunk)]) });
    this.onstop?.();
  }
}
/** Contexte 2D factice : enregistre les textes dessinés ; un caractère mesure 8 px. */
function fakeCtx() {
  const texts: { s: string; y: number }[] = [];
  const rects: number[][] = [];
  const c = {
    font: "",
    fillStyle: "",
    textBaseline: "",
    fillRect: (...r: number[]) => void rects.push(r),
    fillText: (s: string, _x: number, y: number) => void texts.push({ s, y }),
    measureText: (s: string) => ({ width: s.length * 8 }),
    drawImage() {},
  };
  return { c, texts, rects };
}

let ctx = fakeCtx();
let out: { width: number; height: number } = { width: 0, height: 0 };
const listeners = new Map<string, () => void>();
const fakeMap = {
  getCanvas: () => ({ width: 1601, height: 901 }),
  triggerRepaint() {},
  on: (e: string, f: () => void) => void listeners.set(e, f),
  off: (e: string) => void listeners.delete(e),
} as never;

function fakeDocument() {
  ctx = fakeCtx();
  out = { width: 0, height: 0 };
  g.document = {
    createElement: () =>
      Object.assign(out, {
        getContext: () => ctx.c,
        captureStream: () => ({ getTracks: () => [] }),
      }),
  };
}

describe("canRecord", () => {
  it("faux sans MediaRecorder", () => {
    delete g.MediaRecorder;
    g.HTMLCanvasElement = { prototype: { captureStream() {} } };
    assert.equal(canRecord(), false);
  });
  it("faux sans captureStream", () => {
    g.MediaRecorder = FakeRecorder;
    g.HTMLCanvasElement = { prototype: {} };
    assert.equal(canRecord(), false);
  });
  it("vrai avec les deux", () => {
    g.MediaRecorder = FakeRecorder;
    g.HTMLCanvasElement = { prototype: { captureStream() {} } };
    assert.equal(canRecord(), true);
  });
});

describe("recordMap", () => {
  it("refuse un enregistrement vide au lieu de rendre un fichier vide", async () => {
    g.MediaRecorder = FakeRecorder;
    g.HTMLCanvasElement = { prototype: { captureStream() {} } };
    g.requestAnimationFrame = () => 0;
    g.cancelAnimationFrame = () => {};
    fakeDocument();
    FakeRecorder.chunk = 0;
    await assert.rejects(recordMap(fakeMap, VIDEO_CREDITS, 5), /vide/);
    assert.equal(listeners.size, 0, "l'écouteur « render » est retiré même en cas d'échec");
  });
  it("rend l'enregistrement quand il contient des données", async () => {
    g.MediaRecorder = FakeRecorder;
    g.HTMLCanvasElement = { prototype: { captureStream() {} } };
    g.requestAnimationFrame = () => 0;
    g.cancelAnimationFrame = () => {};
    fakeDocument();
    FakeRecorder.chunk = 64;
    const r = await recordMap(fakeMap, VIDEO_CREDITS, 5);
    assert.equal(r.size, 64);
  });
  it("incruste les crédits sous l'image de la carte (dimensions paires)", async () => {
    g.MediaRecorder = FakeRecorder;
    g.HTMLCanvasElement = { prototype: { captureStream() {} } };
    g.requestAnimationFrame = () => 0;
    g.cancelAnimationFrame = () => {};
    fakeDocument();
    FakeRecorder.chunk = 64;
    let during = 0;
    const p = recordMap(fakeMap, VIDEO_CREDITS, 5);
    during = listeners.size;
    await p;
    assert.equal(during, 1, "le canvas composé suit chaque rendu de la carte");
    assert.equal(out.width, 1600);
    assert.ok(out.height > 900 && out.height % 2 === 0, `hauteur ${out.height}`);
    const drawn = ctx.texts.map((t) => t.s).join(" ");
    assert.match(drawn, /Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4\.0/);
    assert.match(drawn, /OpenFreeMap, OpenMapTiles, OpenStreetMap/);
    assert.match(drawn, /simulation/);
    assert.ok(ctx.texts.every((t) => t.y >= 900), "le bandeau est sous la carte, pas dessus");
  });
});

describe("bandeau de crédits", () => {
  it("coupe un crédit trop long aux espaces, chaque crédit sur sa ligne", () => {
    const measure = (s: string) => s.length * 8;
    const lines = wrapCredits([CITY.attribution, "Capteurs : simulation"], 400, measure);
    assert.ok(lines.length > 2);
    assert.ok(lines.every((l) => measure(l) <= 400));
    assert.equal(lines.join(" ").replace(" Capteurs : simulation", ""), CITY.attribution);
    assert.equal(lines.at(-1), "Capteurs : simulation");
    assert.deepEqual(wrapCredits(["un-mot-tres-long"], 10, measure), ["un-mot-tres-long"]);
  });
  it("corps lisible et bandeau assez haut pour ses lignes", () => {
    assert.equal(creditFontPx(1600), 18);
    assert.equal(creditFontPx(400), 12);
    assert.equal(creditFontPx(4000), 20);
    const h = stripHeight(2, 18);
    assert.ok(h >= 2 * 18 * 1.3 && h % 2 === 0);
    const { c, texts, rects } = fakeCtx();
    drawCredits(c as never, ["a", "b"], 800, 600, h, 18);
    assert.deepEqual(rects[0], [0, 600, 800, h]);
    assert.ok(texts.every((t) => t.y >= 600 && t.y + 18 <= 600 + h));
  });
  it("/carte crédite son fond de carte et ses données simulées", () => {
    assert.match(CARTE_VIDEO_CREDITS.join(" "), /OpenFreeMap, OpenMapTiles, OpenStreetMap/);
    assert.match(CARTE_VIDEO_CREDITS.join(" "), /simulées/);
  });
});
