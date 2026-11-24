/**
 * Custom layer MapLibre (mode « 3d ») qui dessine les panneaux HTML capturés.
 *
 * Elle partage le contexte GL et le buffer de profondeur de MapLibre : les bâtiments
 * (fill-extrusion) dessinés avant elle masquent les panneaux placés derrière.
 * À chaque image :
 *  1. calcule le placement de chaque panneau (face caméra ou façade) ;
 *  2. met à jour la géométrie de hit testing (updateElementGeometry, matrice projective, px CSS) ;
 *  3. dessine ombres au sol, panneaux (test de profondeur, brouillard, transition), panneau focalisé
 *     « en rayons X » (sans test de profondeur) ;
 *  4. lance les requêtes d'occlusion : une par panneau (visible ou non) et une sur le pixel sous
 *     le curseur quand on la demande (hit testing avec occlusion).
 */
import type { CustomLayerInterface, Map as MlMap } from "maplibre-gl";
import { metersPerPixel, modelMatrix, mul, PanelProjection, placePanel, viewportMatrix } from "./geometry";

type ML = typeof import("maplibre-gl");

export interface PanelGpu {
  key: string;
  el: HTMLElement | null;
  w: number;
  h: number;
  tex: WebGLTexture | null;
  /** taille allouée de la texture (texels) */
  tw: number;
  th: number;
  /** ouverture du panneau (performance.now) : base de la transition */
  openedAt: number;
  proj: PanelProjection | null;
  model: Float64Array | null;
  /** résultat de la dernière requête d'occlusion du panneau entier */
  visible: boolean | null;
  query: WebGLQuery | null;
  /** latence à émettre au prochain dessin (instant de réception de la donnée) */
  pendingLatency: number;
}

export interface PanelAnchor {
  lng: number;
  lat: number;
  lift: number;
  facade: number;
}

export interface PixelRequest {
  key: string;
  x: number;
  y: number;
  issuedAt: number;
  query?: WebGLQuery;
  resolve(visible: boolean, ms: number): void;
}

export interface PanelLayerOptions {
  anchor(key: string): PanelAnchor | null;
  orientation(): "billboard" | "facade";
  effects(): { fog: boolean; shadow: boolean; transition: "dissolve" | "sweep" | "none" };
  focused(): string | null;
  setGeometry(el: HTMLElement, m: DOMMatrix): void;
  onRender(ms: number, latencies: number[]): void;
}

const VS = `#version 300 es
layout(location=0) in vec2 a;
uniform mat4 u_mvp; uniform mat4 u_model; uniform vec2 u_size;
out vec2 v_uv; out float v_w;
void main() {
  v_uv = a;
  gl_Position = u_mvp * u_model * vec4(a * u_size, 0.0, 1.0);
  v_w = gl_Position.w;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv; in float v_w; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_uvMax;
uniform float u_t; uniform int u_trans;           // transition : 0 aucune, 1 dissolution, 2 balayage
uniform int u_fogOn; uniform vec2 u_fog; uniform vec3 u_fogColor;
uniform float u_xray; uniform int u_shadow;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 c = texture(u_tex, v_uv * u_uvMax);
  if (c.a < 0.5) discard;                         // coins arrondis
  if (u_shadow == 1) { o = vec4(0.0, 0.0, 0.0, 0.28); return; }
  float edge = 0.0;
  if (u_trans == 1 && u_t < 1.0) {                // dissolution par cellules
    float n = hash(floor(v_uv * vec2(46.0, 34.0)));
    if (n > u_t) discard;
    edge = smoothstep(u_t - 0.08, u_t, n);
  } else if (u_trans == 2 && u_t < 1.0) {         // balayage de haut en bas
    if (v_uv.y > u_t) discard;
    edge = smoothstep(u_t - 0.04, u_t, v_uv.y);
  }
  vec3 col = c.rgb + edge * vec3(0.2, 0.45, 1.0);
  if (u_fogOn == 1) col = mix(col, u_fogColor, 0.75 * smoothstep(u_fog.x, u_fog.y, v_w));
  if (u_xray > 0.5) {                             // focus au travers des bâtiments : liseré bleu
    vec2 d = min(v_uv, 1.0 - v_uv);
    if (min(d.x, d.y * 0.75) < 0.012) col = vec3(0.11, 0.37, 0.82);
  }
  o = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext) {
  const mk = (t: number, s: string) => {
    const sh = gl.createShader(t)!;
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

export const TRANSITION_MS = 700;

export class PanelLayer implements CustomLayerInterface {
  id = "hic-panels";
  type = "custom" as const;
  renderingMode = "3d" as const;
  panels = new Map<string, PanelGpu>();
  pixelRequests: PixelRequest[] = [];
  drawn = 0;
  private map!: MlMap;
  private gl!: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private u = new Map<string, WebGLUniformLocation | null>();
  constructor(private ml: ML, private opt: PanelLayerOptions) {}

  onAdd(map: MlMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    this.prog = compile(gl);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    for (const p of this.panels.values()) {
      if (p.tex) gl.deleteTexture(p.tex);
      if (p.query) gl.deleteQuery(p.query);
    }
    this.panels.clear();
  }

  private loc(name: string) {
    if (!this.u.has(name)) this.u.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.u.get(name)!;
  }

  render(gl: WebGL2RenderingContext, o: { defaultProjectionData: { mainMatrix: ArrayLike<number> } }) {
    const t0 = performance.now();
    const ml = this.ml;
    const map = this.map;
    const mvp = o.defaultProjectionData.mainMatrix;
    const canvas = map.getCanvas();
    const vp = viewportMatrix(canvas.clientWidth, canvas.clientHeight);
    const screenFromWorld = mul(vp, mvp);
    const center = map.getCenter();
    const mPerPx = 0.8 * metersPerPixel(center.lat, map.getZoom());
    const bearing = map.getBearing();
    const pitch = map.getPitch();
    const orientation = this.opt.orientation();
    const fx = this.opt.effects();
    const focused = this.opt.focused();
    const now = performance.now();
    const latencies: number[] = [];
    // brouillard : distance (w de clip) du centre de la vue comme référence
    const c = ml.MercatorCoordinate.fromLngLat(center, 0);
    const cw = mvp[3] * c.x + mvp[7] * c.y + mvp[11] * c.z + mvp[15];

    // 1-2. placement et géométrie de hit testing
    const ready: PanelGpu[] = [];
    for (const p of this.panels.values()) {
      const a = this.opt.anchor(p.key);
      if (!a || !p.el) continue;
      const m = ml.MercatorCoordinate.fromLngLat([a.lng, a.lat], 0);
      const placement = placePanel(m, p.w, p.h, m.meterInMercatorCoordinateUnits(), mPerPx, a.lift, orientation, bearing, pitch, a.facade);
      p.model = modelMatrix(placement);
      p.proj = new PanelProjection(mul(screenFromWorld, p.model));
      this.opt.setGeometry(p.el, DOMMatrix.fromFloat64Array(p.proj.m as Float64Array<ArrayBuffer>));
      if (p.tex) ready.push(p);
    }

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc("u_mvp"), false, mvp as Float32Array);
    gl.uniform1i(this.loc("u_tex"), 0);
    gl.uniform1i(this.loc("u_fogOn"), fx.fog ? 1 : 0);
    gl.uniform2f(this.loc("u_fog"), cw * 1.15, cw * 2.6);
    gl.uniform3f(this.loc("u_fogColor"), 0.93, 0.94, 0.95);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const draw = (p: PanelGpu, model: ArrayLike<number>) => {
      gl.uniformMatrix4fv(this.loc("u_model"), false, model as Float32Array);
      gl.uniform2f(this.loc("u_size"), p.w, p.h);
      gl.uniform2f(this.loc("u_uvMax"), Math.min(1, (p.w * this.scale()) / p.tw), Math.min(1, (p.h * this.scale()) / p.th));
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    // 3a. ombres au sol (projection oblique du panneau sur le sol, sous l'ancre)
    if (fx.shadow) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1i(this.loc("u_shadow"), 1);
      gl.uniform1i(this.loc("u_trans"), 0);
      gl.uniform1f(this.loc("u_xray"), 0);
      for (const p of ready) {
        const a = this.opt.anchor(p.key)!;
        const g = ml.MercatorCoordinate.fromLngLat([a.lng, a.lat], 0.3).z;
        // ombre : x' = x + 0.45 (z - g), y' = y + 0.3 (z - g), z' = g
        const S = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0.45, 0.3, 0, 0, -0.45 * g, -0.3 * g, g, 1]);
        draw(p, mul(S, p.model!));
      }
    }

    // 3b. panneaux, avec test de profondeur et requête d'occlusion par panneau
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.uniform1i(this.loc("u_shadow"), 0);
    gl.uniform1f(this.loc("u_xray"), 0);
    let drawn = 0;
    for (const p of ready) {
      const t = Math.min(1, (now - p.openedAt) / TRANSITION_MS);
      gl.uniform1i(this.loc("u_trans"), fx.transition === "dissolve" ? 1 : fx.transition === "sweep" ? 2 : 0);
      gl.uniform1f(this.loc("u_t"), t);
      // résultat de la requête précédente (disponible une image plus tard au plus tôt)
      if (p.query && gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) {
        p.visible = !!gl.getQueryParameter(p.query, gl.QUERY_RESULT);
        gl.deleteQuery(p.query);
        p.query = null;
      }
      const q = p.query ? null : gl.createQuery();
      if (q) gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, q);
      draw(p, p.model!);
      if (q) {
        gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        p.query = q;
      }
      drawn++;
      if (p.pendingLatency) {
        latencies.push(now - p.pendingLatency);
        p.pendingLatency = 0;
      }
    }
    this.drawn = drawn;

    // 3c. panneau focalisé au travers des bâtiments (rayons X)
    const f = focused ? this.panels.get(focused) : undefined;
    if (f?.tex && f.model) {
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1i(this.loc("u_trans"), 0);
      gl.uniform1f(this.loc("u_xray"), 1);
      gl.uniform1i(this.loc("u_fogOn"), 0);
      draw(f, f.model);
      gl.enable(gl.DEPTH_TEST);
    }

    // 4. requêtes d'occlusion sur un pixel (hit testing) : un seul pixel, ni couleur ni profondeur écrites
    this.pixelQueries(gl, now);

    gl.bindVertexArray(null);
    const anim = ready.some((p) => now - p.openedAt < TRANSITION_MS) || this.pixelRequests.length > 0;
    this.opt.onRender(performance.now() - t0, latencies);
    if (anim) map.triggerRepaint();
  }

  private scale() {
    const c = this.map.getCanvas();
    return c.clientWidth ? c.width / c.clientWidth : 1;
  }

  private pixelQueries(gl: WebGL2RenderingContext, now: number) {
    if (!this.pixelRequests.length) return;
    const canvas = this.map.getCanvas();
    const s = this.scale();
    const keep: PixelRequest[] = [];
    for (const r of this.pixelRequests) {
      if (r.query) {
        if (gl.getQueryParameter(r.query, gl.QUERY_RESULT_AVAILABLE)) {
          const visible = !!gl.getQueryParameter(r.query, gl.QUERY_RESULT);
          gl.deleteQuery(r.query);
          r.resolve(visible, now - r.issuedAt);
        } else keep.push(r);
        continue;
      }
      const p = this.panels.get(r.key);
      if (!p?.tex || !p.model) {
        r.resolve(false, now - r.issuedAt);
        continue;
      }
      r.query = gl.createQuery()!;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.floor(r.x * s), Math.floor(canvas.height - r.y * s) - 1, 1, 1);
      gl.colorMask(false, false, false, false);
      gl.depthMask(false);
      gl.enable(gl.DEPTH_TEST);
      gl.uniform1i(this.loc("u_trans"), 0);
      gl.uniform1i(this.loc("u_shadow"), 0);
      gl.uniformMatrix4fv(this.loc("u_model"), false, p.model as unknown as Float32Array);
      gl.uniform2f(this.loc("u_size"), p.w, p.h);
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.beginQuery(gl.ANY_SAMPLES_PASSED, r.query);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.endQuery(gl.ANY_SAMPLES_PASSED);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.disable(gl.SCISSOR_TEST);
      keep.push(r);
    }
    this.pixelRequests = keep;
  }
}
