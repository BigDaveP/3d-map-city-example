/**
 * Rendu WebGL2 du mur en mode HTML-in-Canvas.
 *   1. fonds de régions (tuiles SDF instanciées) ;
 *   2. tuile colorée de chaque carte visible (toujours dessinée : sert de fond au fondu) ;
 *   3. textures HTML capturées (niveau précédent opaque, niveau courant en fondu par-dessus) ;
 *   4. sparklines en WebGL, par-dessus les textures des cartes « ventes ».
 * Toutes les représentations couvrent le même rectangle monde : aucun saut de position.
 */
import { KINDS } from "@/lib/sim/types";
import { CARD_W, type Level, type WorldLayout } from "@/lib/world";
import type { LiveState } from "../live";
import { CARD_CSS, SPARK_ZONE } from "../wall/cards/zones";
import { INSTANCE_FLOATS, Programs } from "./gl";
import { SparkBuilder } from "./spark";
import type { Slot, TextureStore } from "./textures";

export const FADE_MS = 160;
const STATUS_RGB: [number, number, number][] = [
  [0.122, 0.435, 0.208],
  [0.635, 0.451, 0.094],
  [0.765, 0.231, 0.208],
];
const SPARK_RGBA: [number, number, number, number] = [0.345, 0.651, 1, 1];
const SALES = KINDS.indexOf("sales");

/** Représentation affichée par carte et fondu en cours. */
export class DisplayState {
  shown: Int8Array;
  prev: Int8Array;
  fadeStart: Float64Array;
  constructor(n: number) {
    this.shown = new Int8Array(n);
    this.prev = new Int8Array(n);
    this.fadeStart = new Float64Array(n);
  }
  /**
   * Passe au niveau cible dès qu'une texture existe pour lui ; sinon garde la représentation
   * actuelle (une texture intermédiaire agrandie vaut mieux qu'un trou ou un flash).
   */
  update(card: number, target: Level, store: TextureStore, now: number) {
    let shown = this.shown[card];
    if (shown > 0 && !usable(store.get(card, shown))) {
      shown = 0;
      this.shown[card] = 0;
      this.prev[card] = 0;
    }
    if (shown === target) return;
    if (target === 0 || usable(store.get(card, target))) {
      this.prev[card] = shown;
      this.shown[card] = target;
      this.fadeStart[card] = now;
    }
  }
  reset() {
    this.shown.fill(0);
    this.prev.fill(0);
  }
}
const usable = (s: Slot | undefined) => !!s && s.version >= 0;

interface Range {
  first: number;
  count: number;
  tex: WebGLTexture;
}

export class WallRenderer {
  private p: Programs;
  private regionInst: Float32Array;
  private tileInst: Float32Array;
  private texInst: Float32Array;
  private spark = new SparkBuilder();
  drawCalls = 0;
  /** interrupteurs de couches (diagnostic : coût de chaque couche) */
  layers = { regions: true, tiles: true, textures: true, sparklines: true };

  constructor(private gl: WebGL2RenderingContext, private layout: WorldLayout) {
    this.p = new Programs(gl);
    const n = layout.cards.length / 4;
    this.tileInst = new Float32Array(n * INSTANCE_FLOATS);
    this.texInst = new Float32Array(n * 2 * INSTANCE_FLOATS);
    this.regionInst = new Float32Array(layout.regions.length * INSTANCE_FLOATS);
    layout.regions.forEach((r, i) => put(this.regionInst, i, r.x, r.y, r.w, r.h, 0, 0, 1, 1, 0.059, 0.082, 0.114, 1));
  }

  draw(o: {
    cam: { x: number; y: number; zoom: number; vw: number; vh: number };
    width: number;
    height: number;
    visible: readonly number[];
    levelOf: (card: number) => Level;
    store: TextureStore;
    display: DisplayState;
    live: LiveState;
    now: number;
    frame: number;
  }): boolean {
    const { gl, p, layout } = this;
    const { cam, visible, store, display, live, now, frame } = o;
    const C = layout.cards;
    this.drawCalls = 0;
    gl.viewport(0, 0, o.width, o.height);
    gl.clearColor(0.031, 0.043, 0.063, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(p.quadVao);

    // 1-2. régions et tuiles
    gl.useProgram(p.tile);
    p.setCamera(p.tile, cam.x, cam.y, cam.zoom, cam.vw, cam.vh);
    gl.uniform1f(p.loc(p.tile, "u_zoom"), cam.zoom);
    gl.uniform1f(p.loc(p.tile, "u_radius"), 40);
    // régions et tuiles sont opaques : sans arrondi visible, pas de mélange (fill-rate)
    if (40 * cam.zoom < 1.5) gl.disable(gl.BLEND);
    this.upload(this.regionInst, layout.regions.length);
    if (this.layers.regions) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, layout.regions.length);
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const rgb = STATUS_RGB[live.statuses[c]] ?? STATUS_RGB[0];
      put(this.tileInst, i, C[c * 4], C[c * 4 + 1], C[c * 4 + 2], C[c * 4 + 3], 0, 0, 1, 1, rgb[0], rgb[1], rgb[2], 1);
    }
    gl.uniform1f(p.loc(p.tile, "u_radius"), 12);
    if (12 * cam.zoom < 1.5) gl.disable(gl.BLEND);
    else gl.enable(gl.BLEND);
    this.upload(this.tileInst, visible.length);
    if (this.layers.tiles) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, visible.length);
    this.drawCalls += 2;
    gl.enable(gl.BLEND);

    // 3. textures : d'abord les niveaux précédents (base opaque), puis le niveau courant en fondu
    const base: [number, Slot, number][] = [];
    const top: [number, Slot, number][] = [];
    let fading = false;
    for (const c of visible) {
      display.update(c, o.levelOf(c), store, now);
      const shown = display.shown[c];
      const prev = display.prev[c];
      const t = Math.min(1, (now - display.fadeStart[c]) / FADE_MS);
      if (t < 1) fading = true;
      const sPrev = prev > 0 && t < 1 ? store.get(c, prev) : undefined;
      const sShown = shown > 0 ? store.get(c, shown) : undefined;
      if (sPrev && usable(sPrev)) {
        // vers le niveau éloigné : la texture s'efface au-dessus de la tuile
        base.push([c, sPrev, shown > 0 ? 1 : 1 - t]);
        sPrev.lastUsed = frame;
      }
      if (sShown && usable(sShown)) {
        top.push([c, sShown, sPrev ? t : t < 1 && prev === 0 ? t : 1]);
        sShown.lastUsed = frame;
      }
    }
    const all = base.concat(top);
    if (all.length) {
      gl.useProgram(p.tex);
      p.setCamera(p.tex, cam.x, cam.y, cam.zoom, cam.vw, cam.vh);
      gl.uniform1i(p.loc(p.tex, "u_tex"), 0);
      gl.activeTexture(gl.TEXTURE0);
      const ranges: Range[] = [];
      if (store.kind === "atlas") {
        // tri stable par page à l'intérieur de chaque passe => un appel par (passe, page)
        const sortByPage = (a: [number, Slot, number], b: [number, Slot, number]) => a[1].page - b[1].page;
        const ordered = base.sort(sortByPage).concat(top.sort(sortByPage));
        ordered.forEach((e, i) => this.putTex(i, e));
        for (let i = 0; i < ordered.length; i++) {
          const last = ranges[ranges.length - 1];
          if (last && last.tex === ordered[i][1].tex && last.first + last.count === i) last.count++;
          else ranges.push({ first: i, count: 1, tex: ordered[i][1].tex });
        }
        this.upload(this.texInst, ordered.length);
      } else {
        all.forEach((e, i) => {
          this.putTex(i, e);
          ranges.push({ first: i, count: 1, tex: e[1].tex });
        });
        this.upload(this.texInst, all.length);
      }
      for (const r of ranges) {
        gl.bindTexture(gl.TEXTURE_2D, r.tex);
        p.bindInstances(r.first);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, r.count);
        this.drawCalls++;
      }
      p.bindInstances(0);
    }

    // 4. sparklines (jamais dans le HTML capturé)
    this.spark.reset();
    for (const [c, s, alpha] of all) {
      if (c % KINDS.length !== SALES) continue;
      const lvl = s.level as 1 | 2;
      const k = CARD_W / CARD_CSS[lvl].w;
      const z = SPARK_ZONE[lvl];
      const b = Math.floor(c / KINDS.length);
      this.spark.addSeries(
        (out) => live.sparkSeries(b, out),
        C[c * 4] + z.x * k,
        C[c * 4 + 1] + z.y * k,
        z.w * k,
        z.h * k,
        cam.zoom,
        (lvl === 2 ? 1.5 : 1.2) * k * cam.zoom,
        [SPARK_RGBA[0], SPARK_RGBA[1], SPARK_RGBA[2], alpha],
        2 * k,
      );
    }
    if (this.spark.count) {
      gl.useProgram(p.line);
      p.setCamera(p.line, cam.x, cam.y, cam.zoom, cam.vw, cam.vh);
      gl.bindVertexArray(p.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.spark.view(), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, this.spark.count);
      this.drawCalls++;
    }
    gl.bindVertexArray(null);
    return fading;
  }

  private putTex(i: number, [c, s, alpha]: [number, Slot, number]) {
    const C = this.layout.cards;
    put(this.texInst, i, C[c * 4], C[c * 4 + 1], C[c * 4 + 2], C[c * 4 + 3], s.x / s.tw, s.y / s.th, (s.x + s.w) / s.tw, (s.y + s.h) / s.th, 1, 1, 1, alpha);
  }

  private upload(data: Float32Array, count: number) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.p.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * INSTANCE_FLOATS), gl.STREAM_DRAW);
  }
}

function put(a: Float32Array, i: number, x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, al: number) {
  const o = i * INSTANCE_FLOATS;
  a[o] = x;
  a[o + 1] = y;
  a[o + 2] = w;
  a[o + 3] = h;
  a[o + 4] = u0;
  a[o + 5] = v0;
  a[o + 6] = u1;
  a[o + 7] = v1;
  a[o + 8] = r;
  a[o + 9] = g;
  a[o + 10] = b;
  a[o + 11] = al;
}
