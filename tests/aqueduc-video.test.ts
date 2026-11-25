/** Export vidéo : détection des API d'enregistrement et refus d'un fichier vide (R19). */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { canRecord, recordMap } from "../src/client/carte/video";

const g = globalThis as Record<string, unknown>;
const saved = { MediaRecorder: g.MediaRecorder, HTMLCanvasElement: g.HTMLCanvasElement, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame };
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
const fakeMap = { getCanvas: () => ({ captureStream: () => ({ getTracks: () => [] }) }), triggerRepaint() {} } as never;

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
    FakeRecorder.chunk = 0;
    await assert.rejects(recordMap(fakeMap, 5), /vide/);
  });
  it("rend l'enregistrement quand il contient des données", async () => {
    g.MediaRecorder = FakeRecorder;
    g.HTMLCanvasElement = { prototype: { captureStream() {} } };
    g.requestAnimationFrame = () => 0;
    g.cancelAnimationFrame = () => {};
    FakeRecorder.chunk = 64;
    const r = await recordMap(fakeMap, 5);
    assert.equal(r.size, 64);
  });
});
