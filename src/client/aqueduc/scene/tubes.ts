/**
 * Vue souterraine : les conduites en vrais tubes 3D, environ 2 m sous la rue.
 *
 * Custom layer WebGL2 (mode « 3d ») : un cylindre à 8 faces instancié, une instance par
 * sous-segment de conduite, dans le même contexte et le même tampon de profondeur que MapLibre et
 * les surfaces HTML-in-Canvas. Elle est insérée avant `building-3d` : les bâtiments, translucides en
 * vue souterraine, se dessinent par-dessus et laissent voir les tubes qu'ils recouvrent ; les couches
 * 2D du fond n'écrivent pas la profondeur, donc les tubes transparaissent sous le sol estompé.
 *
 * Précision : les positions d'instance sont relatives à une origine locale (centre de la ville, en
 * Mercator) et la matrice envoyée au shader est projection × translation(origine), multipliée en
 * Float64 sur le CPU. Des coordonnées Mercator absolues en Float32 (~0,3, à ~1 m près) multipliées
 * par la projection dans le shader décaleraient la profondeur de plusieurs mètres (voir `clipFrom`
 * dans `hic3d/panelLayer.ts`).
 *
 * Rendu à la demande : `triggerRepaint` seulement quand les instances ou les couleurs changent.
 */
import type { CustomLayerInterface, Map as MlMap } from "maplibre-gl";
import { CITY } from "@/lib/aqueduc/city";
import type { PipeClass } from "@/lib/aqueduc/network";
import { FLUSHING_2026 } from "@/lib/aqueduc/sim";
import { mul } from "../../hic3d/geometry";
import type { NetIndex } from "../net";
import { BAD_RGB, NO_DATA_RGB, rampColor, setUnderground } from "../pipes";
import { aqueducStore, type AqState } from "../store";

/** Facteur d'exagération des diamètres, indiqué à l'écran. */
export const TUBE_EXAGGERATION = 12;
/** Profondeur de l'axe des conduites sous la rue (m). */
export const TUBE_DEPTH_M = 2;
/**
 * Garde minimale entre le dessus d'un tube exagéré et la rue (m) : au-delà de 300 mm, rayon exagéré
 * et garde dépassent 2 m et l'axe descend d'autant ; sinon le tube percerait la chaussée (jusqu'à
 * +1,6 m pour 600 mm), devant les marquages au sol et le pied des bâtiments.
 */
const TUBE_COVER_M = 0.2;
/** Floats par instance : début xyz, fin xyz, rayon (Mercator). */
export const TUBE_FLOATS = 7;
export const TUBE_LAYER_ID = "aq-tubes";
/** Calque devant lequel insérer les tubes : les bâtiments translucides se dessinent par-dessus. */
const BEFORE = "building-3d";

/** Circonférence terrestre de MapLibre (rayon 6 371 008,8 m). */
const EARTH = 2 * Math.PI * 6371008.8;
const RAD = Math.PI / 180;

/** Coordonnées Mercator de MapLibre (0..1), comme `MercatorCoordinate.fromLngLat`. */
export function mercator(lng: number, lat: number): [number, number] {
  return [(180 + lng) / 360, (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))) / 360];
}
/** Un mètre en unités Mercator à la latitude (horizontal comme vertical). */
const unitAt = (lat: number) => 1 / (EARTH * Math.cos(lat * RAD));

/**
 * Instances des tubes : une par sous-segment (paire de sommets consécutifs), avec début xyz, fin
 * xyz et rayon en unités Mercator. z = −`depthM` mètres à la latitude de chaque sommet (abaissé pour
 * un tube dont le rayon exagéré dépasserait la rue : dessus à −0,2 m) ; rayon = diamètre (mm) / 2 ×
 * `exaggeration`, en mètres à la latitude du milieu. Les x, y sont relatifs à
 * `origin` (Mercator) pour garder la précision en Float32. Fonction pure.
 */
export function buildTubeInstances(
  segs: readonly { coords: Float64Array; diameter: number }[],
  exaggeration: number,
  depthM: number,
  origin: readonly [number, number] = [0, 0],
): Float32Array {
  let n = 0;
  for (const s of segs) n += Math.max(0, s.coords.length / 2 - 1);
  const out = new Float32Array(n * TUBE_FLOATS);
  let o = 0;
  for (const s of segs) {
    const c = s.coords;
    const r = (s.diameter / 2000) * exaggeration;
    const depth = Math.max(depthM, r + TUBE_COVER_M);
    for (let k = 2; k < c.length; k += 2) {
      const [ax, ay] = mercator(c[k - 2], c[k - 1]);
      const [bx, by] = mercator(c[k], c[k + 1]);
      out[o++] = ax - origin[0];
      out[o++] = ay - origin[1];
      out[o++] = -depth * unitAt(c[k - 1]);
      out[o++] = bx - origin[0];
      out[o++] = by - origin[1];
      out[o++] = -depth * unitAt(c[k + 1]);
      out[o++] = r * unitAt((c[k - 1] + c[k + 1]) / 2);
    }
  }
  return out;
}

/**
 * Tronçons dessinés en tubes : par défaut les conduites maîtresses et d'amenée de toute la ville et
 * tous les tronçons de la zone suivie (`demoSegments`) ; avec `all`, tout le réseau. Indices triés.
 */
export function tubeSegments(classes: readonly PipeClass[], demo: readonly number[], all: boolean): number[] {
  if (all) return classes.map((_, i) => i);
  const keep = new Set(demo);
  return classes.flatMap((c, i) => (keep.has(i) || c === "maitresse" || c === "amenee" ? [i] : []));
}

const VS = `#version 300 es
layout(location=0) in vec2 a_mesh;     // t (0 début, 1 fin), angle autour de l'axe
layout(location=1) in vec3 a_a;        // début (Mercator, relatif à l'origine)
layout(location=2) in vec3 a_b;        // fin
layout(location=3) in float a_r;       // rayon (Mercator)
layout(location=4) in vec3 a_color;
uniform mat4 u_matrix;                 // projection × translation(origine), calculé en Float64
out vec3 v_color; out vec3 v_n;
void main() {
  vec3 d = a_b - a_a;
  float len = length(d);
  vec3 ax = len > 0.0 ? d / len : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(ax, vec3(0.0, 0.0, 1.0)));
  vec3 v = cross(u, ax);
  vec3 n = cos(a_mesh.y) * u + sin(a_mesh.y) * v;
  // les tubes débordent d'un demi-rayon à chaque bout : pas de fente aux coudes
  vec3 p = mix(a_a - ax * a_r * 0.5, a_b + ax * a_r * 0.5, a_mesh.x) + n * a_r;
  v_color = a_color; v_n = n;
  gl_Position = u_matrix * vec4(p, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 v_color; in vec3 v_n; out vec4 o;
// lumière venue du nord-ouest, en hauteur (Mercator : y vers le sud)
const vec3 L = vec3(-0.45, -0.55, 0.70);
void main() {
  vec3 n = normalize(v_n);
  float k = 0.62 + 0.38 * max(dot(n, normalize(L)), 0.0);
  // reflet le long du dessus du tube : on lit un cylindre, pas un ruban
  float spec = 0.2 * pow(max(n.z, 0.0), 8.0);
  o = vec4(min(v_color * k + spec, vec3(1.0)), 1.0);
}`;

const SIDES = 8;

/** Compile et lie le programme des tubes ; en cas d'échec, libère ce qui a été créé et lève une exception. */
export function compile(gl: WebGL2RenderingContext) {
  const made: WebGLShader[] = [];
  const mk = (t: number, s: string) => {
    const sh = gl.createShader(t)!;
    made.push(sh);
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`compilation du shader : ${gl.getShaderInfoLog(sh) || "refusée"}`);
    return sh;
  };
  const p = gl.createProgram()!;
  try {
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`édition des liens : ${gl.getProgramInfoLog(p) || "refusée"}`);
    return p;
  } catch (e) {
    gl.deleteProgram(p);
    throw e;
  } finally {
    for (const sh of made) gl.deleteShader(sh);
  }
}

/** Cylindre ouvert : 2 sommets par angle (début, fin), 2 triangles par face. */
function cylinder() {
  const verts = new Float32Array(SIDES * 2 * 2);
  const idx = new Uint8Array(SIDES * 6);
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    verts.set([0, a, 1, a], i * 4);
    const j = (i + 1) % SIDES;
    idx.set([i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1], i * 6);
  }
  return { verts, idx };
}

export type TubeLayer = CustomLayerInterface & {
  /** origine locale des instances (Mercator) */
  origin: [number, number];
  /** raison de l'échec de `onAdd` (compilation ou édition des liens des shaders) ; vide sinon */
  error: string;
  setInstances(a: Float32Array): void;
  /** RGB (0–255) par instance */
  setColors(c: Uint8Array): void;
  stats: { instances: number };
};

/**
 * Couche des tubes. `origin` : origine locale des instances (Mercator) ; `onRender` reçoit le temps
 * JS de chaque rendu (métriques).
 */
export function createTubeLayer(origin: [number, number] = mercator(...CITY.center), onRender?: (ms: number) => void): TubeLayer {
  let map: MlMap | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let prog: WebGLProgram;
  let vao: WebGLVertexArrayObject;
  let instBuf: WebGLBuffer;
  let colorBuf: WebGLBuffer;
  let meshBufs: WebGLBuffer[] = [];
  let instances: Float32Array = new Float32Array(0);
  let colors: Uint8Array = new Uint8Array(0);
  let dirtyInst = true;
  let dirtyColor = true;
  let ready = false;
  const stats = { instances: 0 };
  const translate = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, origin[0], origin[1], 0, 1]);
  const repaint = () => map?.triggerRepaint();
  /** Programme, VAO et tampons ; lève une exception si le pilote refuse les shaders. */
  const setup = (gl: WebGL2RenderingContext) => {
    prog = compile(gl);
    vao = gl.createVertexArray()!;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    gl.bindVertexArray(vao);
    const { verts, idx } = cylinder();
    const mesh = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const stride = TUBE_FLOATS * 4;
    for (const [loc, size, off] of [
      [1, 3, 0],
      [2, 3, 12],
      [3, 1, 24],
    ]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    colorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.UNSIGNED_BYTE, true, 3, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(prevVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
    meshBufs = [mesh, ib];
    dirtyInst = dirtyColor = true;
  };
  const layer: TubeLayer = {
    id: TUBE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    origin,
    stats,
    error: "",
    setInstances(a) {
      instances = a;
      dirtyInst = true;
      repaint();
    },
    setColors(c) {
      colors = c;
      dirtyColor = true;
      repaint();
    },
    onAdd(m, g) {
      // onAdd est appelé par map.addLayer, depuis un abonné du store : une exception y casserait la
      // mise à jour du store. Un pilote qui refuse les shaders laisse la couche inerte, avec la raison.
      try {
        setup(g as WebGL2RenderingContext);
        map = m;
        gl = g as WebGL2RenderingContext;
        ready = true;
        layer.error = "";
      } catch (e) {
        ready = false;
        layer.error = (e as Error).message || "shaders refusés";
      }
    },
    onRemove(_m, g) {
      if (ready) {
        const c = g as WebGL2RenderingContext;
        for (const b of [...meshBufs, instBuf, colorBuf]) c.deleteBuffer(b);
        c.deleteVertexArray(vao);
        c.deleteProgram(prog);
      }
      ready = false;
      meshBufs = [];
      stats.instances = 0;
      map = null;
      gl = null;
    },
    render(g, o) {
      if (!ready) return;
      const t0 = performance.now();
      const c = g as WebGL2RenderingContext;
      const n = Math.min(instances.length / TUBE_FLOATS, colors.length / 3);
      stats.instances = n;
      if (!n) return void onRender?.(performance.now() - t0);
      // état GL de MapLibre sauvegardé puis rendu tel quel
      const prev = {
        prog: c.getParameter(c.CURRENT_PROGRAM),
        vao: c.getParameter(c.VERTEX_ARRAY_BINDING),
        buf: c.getParameter(c.ARRAY_BUFFER_BINDING),
        depthTest: c.isEnabled(c.DEPTH_TEST),
        depthFunc: c.getParameter(c.DEPTH_FUNC),
        depthMask: c.getParameter(c.DEPTH_WRITEMASK),
        blend: c.isEnabled(c.BLEND),
        cull: c.isEnabled(c.CULL_FACE),
      };
      c.useProgram(prog);
      c.bindVertexArray(vao);
      if (dirtyInst) {
        c.bindBuffer(c.ARRAY_BUFFER, instBuf);
        c.bufferData(c.ARRAY_BUFFER, instances, c.STATIC_DRAW);
        dirtyInst = false;
      }
      if (dirtyColor) {
        c.bindBuffer(c.ARRAY_BUFFER, colorBuf);
        c.bufferData(c.ARRAY_BUFFER, colors, c.DYNAMIC_DRAW);
        dirtyColor = false;
      }
      c.uniformMatrix4fv(c.getUniformLocation(prog, "u_matrix"), false, new Float32Array(mul(o.defaultProjectionData.mainMatrix, translate)));
      c.enable(c.DEPTH_TEST);
      c.depthFunc(c.LEQUAL);
      c.depthMask(true);
      c.disable(c.BLEND);
      c.disable(c.CULL_FACE);
      c.drawElementsInstanced(c.TRIANGLES, SIDES * 6, c.UNSIGNED_BYTE, 0, n);
      c.useProgram(prev.prog);
      c.bindVertexArray(prev.vao);
      c.bindBuffer(c.ARRAY_BUFFER, prev.buf);
      if (!prev.depthTest) c.disable(c.DEPTH_TEST);
      c.depthFunc(prev.depthFunc);
      c.depthMask(prev.depthMask);
      if (prev.blend) c.enable(c.BLEND);
      if (prev.cull) c.enable(c.CULL_FACE);
      onRender?.(performance.now() - t0);
    },
  };
  return layer;
}

const SELECTED_RGB: [number, number, number] = [0x14, 0x21, 0x33];
const FLUSH_INDEX = new Map(FLUSHING_2026.map((f, k) => [f.sectorId, k]));

/**
 * Couleur d'un tronçon, comme `pipeColor` : pression et chlore du flux pour la zone suivie (gris
 * neutre ailleurs, le flux ne couvre que `demoSegments`), âge, période de rinçage et bris
 * antérieurs pour tout le réseau ; sélection en bleu nuit, incident en rouge sur la couche Incidents.
 */
function segmentColor(net: NetIndex, s: AqState, i: number, sel: number | null, inc: number | null): readonly [number, number, number] {
  if (i === sel) return SELECTED_RGB;
  const p = net.data.segments.features[i].properties;
  switch (s.layer) {
    case "pression":
    case "qualite": {
      const k = net.demoPos.get(i);
      const values = s.layer === "pression" ? s.live.pressure : s.live.chlorine;
      return k !== undefined && k < values.length ? rampColor(s.layer, values[k]) : NO_DATA_RGB;
    }
    case "age":
      return p.y === null ? NO_DATA_RGB : rampColor("age", p.y);
    case "rincage": {
      const k = FLUSH_INDEX.get(p.s);
      return k === undefined ? NO_DATA_RGB : rampColor("rincage", k);
    }
    case "incidents":
      return i === inc ? BAD_RGB : rampColor("incidents", p.b);
  }
}

/**
 * Vue souterraine pilotée par le store (`underground`, `undergroundAll`) : estompe le fond, ajoute
 * ou retire la couche des tubes, recalcule les instances (une fois par jeu de tronçons, mises en
 * cache) et les couleurs (couche, flux, sélection, incident). Renvoie la couche (pilotage, métriques)
 * et la fonction de détachement.
 */
export function attachUnderground(map: MlMap, net: NetIndex, onRender?: (ms: number) => void) {
  const layer = createTubeLayer(mercator(...CITY.center), onRender);
  const feats = net.data.segments.features;
  const classes = feats.map((f) => f.properties.c);
  const cache = new Map<boolean, { segs: number[]; counts: Uint32Array; instances: Float32Array }>();
  const variant = (all: boolean) => {
    let v = cache.get(all);
    if (!v) {
      const segs = tubeSegments(classes, net.data.demoSegments, all);
      const input = segs.map((i) => ({ coords: Float64Array.from(feats[i].geometry.coordinates.flat()), diameter: feats[i].properties.d }));
      v = { segs, counts: Uint32Array.from(input, (x) => Math.max(0, x.coords.length / 2 - 1)), instances: buildTubeInstances(input, TUBE_EXAGGERATION, TUBE_DEPTH_M, layer.origin) };
      cache.set(all, v);
    }
    return v;
  };
  let current: ReturnType<typeof variant> | null = null;
  let last = new Uint8Array(0);

  const recolor = (s: AqState) => {
    if (!current) return;
    const sel = s.selection && (s.selection.kind === "segment" || s.selection.kind === "incident") ? (net.segById.get(s.selection.id) ?? null) : null;
    const inc = s.incident ? (net.segById.get(CITY.breakSegment) ?? null) : null;
    const out = new Uint8Array(current.instances.length / TUBE_FLOATS * 3);
    let o = 0;
    current.segs.forEach((i, k) => {
      const rgb = segmentColor(net, s, i, sel, inc);
      for (let n = current!.counts[k]; n > 0; n--) {
        out[o++] = rgb[0];
        out[o++] = rgb[1];
        out[o++] = rgb[2];
      }
    });
    // rendu à la demande : rien n'est envoyé si les couleurs n'ont pas changé
    if (out.length === last.length && out.every((x, j) => x === last[j])) return;
    last = out;
    layer.setColors(out);
  };

  /**
   * Tubes impossibles (shaders refusés, autre erreur de `addLayer`) : couche retirée, conduites
   * gardées au sol et fond non estompé ; la raison va au panneau des couches.
   */
  const fail = (why: string) => {
    try {
      if (map.getLayer(TUBE_LAYER_ID)) map.removeLayer(TUBE_LAYER_ID);
    } catch {}
    setUnderground(map, false);
    current = null;
    last = new Uint8Array(0);
    if (aqueducStore.getState().undergroundError !== why) aqueducStore.setState({ undergroundError: why });
  };

  const sync = (s: AqState, prev: AqState | null) => {
    const on = s.underground;
    // échec retenu : on ne réessaie pas (même pilote, même refus)
    if (layer.error) return;
    if (!prev || on !== prev.underground) {
      if (on && !map.getLayer(TUBE_LAYER_ID)) {
        try {
          map.addLayer(layer, map.getLayer(BEFORE) ? BEFORE : undefined);
        } catch (e) {
          layer.error ||= (e as Error).message || "couche refusée";
        }
        if (layer.error) return fail(layer.error);
      }
      setUnderground(map, on);
      if (!on && map.getLayer(TUBE_LAYER_ID)) map.removeLayer(TUBE_LAYER_ID);
    }
    if (!on) {
      current = null;
      last = new Uint8Array(0);
      return;
    }
    const next = variant(s.undergroundAll);
    if (next !== current) {
      current = next;
      layer.setInstances(next.instances);
      last = new Uint8Array(0);
      recolor(s);
    } else if (!prev || s.layer !== prev.layer || s.live !== prev.live || s.selection !== prev.selection || s.incident !== prev.incident) recolor(s);
  };

  sync(aqueducStore.getState(), null);
  const off = aqueducStore.subscribe((s, prev) => sync(s, prev));
  return {
    layer,
    detach() {
      off();
      // la carte peut déjà être détruite (démontage de la page) : plus rien à rendre
      try {
        if (map.getLayer(TUBE_LAYER_ID)) map.removeLayer(TUBE_LAYER_ID);
        setUnderground(map, false);
      } catch {}
    },
  };
}
