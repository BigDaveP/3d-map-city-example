/**
 * Couche WebGL partagée (les deux modes) : ce qui change souvent reste en WebGL.
 *  - disque de statut au sol sous chaque restaurant (vert / orange / gris) ;
 *  - anneaux de pulsation si des commandes attendent ;
 *  - livreurs (positions interpolées entre deux messages SSE).
 * Custom layer MapLibre en mode « 3d » : les bâtiments masquent les livreurs.
 */
import type { CustomLayerInterface, Map as MlMap } from "maplibre-gl";
import { COURIERS, RESTAURANTS } from "@/lib/carte/catalog";
import { carteStore, couriers } from "./store";

type ML = typeof import("maplibre-gl");

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;            // -1..1
layout(location=1) in vec4 a_center;            // x, y, z (mercator), rayon (mercator)
layout(location=2) in vec4 a_color;
layout(location=3) in vec2 a_kind;              // 0 disque, 1 anneau ; phase
uniform mat4 u_matrix;
out vec2 v_p; out vec4 v_color; out vec2 v_kind;
void main() {
  v_p = a_corner; v_color = a_color; v_kind = a_kind;
  vec3 w = vec3(a_center.xy + a_corner * a_center.w, a_center.z);
  gl_Position = u_matrix * vec4(w, 1.0);
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 v_p; in vec4 v_color; in vec2 v_kind; out vec4 o;
uniform float u_time;
void main() {
  float d = length(v_p);
  if (v_kind.x < 0.5) {                          // disque plein bordé
    float a = smoothstep(1.0, 0.92, d);
    float rim = smoothstep(0.7, 0.8, d) * 0.35;
    o = vec4(mix(v_color.rgb, vec3(1.0), rim), 1.0) * a * v_color.a;
  } else {                                       // anneau qui s'élargit et s'efface
    float t = fract(u_time / 1.6 + v_kind.y);
    float r = 0.35 + 0.65 * t;
    float a = smoothstep(0.08, 0.0, abs(d - r)) * (1.0 - t);
    o = vec4(v_color.rgb, 1.0) * a * v_color.a;
  }
  if (o.a < 0.01) discard;
}`;

const STATUS_RGB: Record<string, [number, number, number]> = {
  ouvert: [0.13, 0.62, 0.33],
  achalandé: [0.92, 0.55, 0.1],
  pause: [0.5, 0.52, 0.56],
};

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const mk = (t: number, s: string) => {
    const sh = gl.createShader(t)!;
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

const FLOATS = 4 + 4 + 2;

export function createDynamicsLayer(ml: ML, onRender: (ms: number) => void): CustomLayerInterface & { stats: { instances: number } } {
  let prog: WebGLProgram;
  let vao: WebGLVertexArrayObject;
  let inst: WebGLBuffer;
  let map: MlMap;
  const data = new Float32Array((RESTAURANTS.length * 2 + COURIERS.length) * FLOATS);
  const t0 = performance.now();
  const rest = RESTAURANTS.map((r) => ml.MercatorCoordinate.fromLngLat([r.lng, r.lat], 1));
  const stats = { instances: 0 };
  return {
    id: "dynamics",
    type: "custom",
    renderingMode: "3d",
    stats,
    onAdd(m, gl) {
      map = m;
      prog = compile(gl, VS, FS);
      vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const corners = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      inst = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      const stride = FLOATS * 4;
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
      gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 32);
      gl.vertexAttribDivisor(3, 1);
      gl.bindVertexArray(null);
    },
    render(gl, o) {
      const tStart = performance.now();
      const s = carteStore.getState();
      const now = performance.now();
      let n = 0;
      const put = (x: number, y: number, z: number, r: number, rgb: [number, number, number], a: number, kind: number, phase: number) => {
        data.set([x, y, z, r, rgb[0], rgb[1], rgb[2], a, kind, phase], n * FLOATS);
        n++;
      };
      RESTAURANTS.forEach((r, i) => {
        if (r.city !== s.city) return;
        const m = rest[i];
        const unit = m.meterInMercatorCoordinateUnits();
        const live = s.restaurants[i];
        const rgb = STATUS_RGB[live.status];
        put(m.x, m.y, m.z, 22 * unit, rgb, 0.9, 0, 0);
        if (s.pulse && live.pending > 0 && live.status !== "pause") put(m.x, m.y, m.z, 70 * unit, rgb, 0.9, 1, (i * 0.37) % 1);
      });
      let moving = false;
      COURIERS.forEach((c, i) => {
        if (c.city !== s.city || !couriers.known[i]) return;
        const [lng, lat] = couriers.position(i, now);
        if (now < couriers.t1[i]) moving = true;
        const m = ml.MercatorCoordinate.fromLngLat([lng, lat], 3);
        const open = s.openCouriers.includes(i);
        put(m.x, m.y, m.z, 11 * m.meterInMercatorCoordinateUnits(), open ? [0.2, 0.55, 1] : [0.1, 0.35, 0.85], 1, 0, 0);
      });
      stats.instances = n;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "u_matrix"), false, o.defaultProjectionData.mainMatrix as Float32Array);
      gl.uniform1f(gl.getUniformLocation(prog, "u_time"), (now - t0) / 1000);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * FLOATS), gl.STREAM_DRAW);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.bindVertexArray(null);
      onRender(performance.now() - tStart);
      // rendu à la demande : on ne redemande une image que si quelque chose bouge
      if (moving || s.pulse) map.triggerRepaint();
    },
  };
}
