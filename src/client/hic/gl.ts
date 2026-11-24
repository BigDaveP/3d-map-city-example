/** WebGL2 brut : programmes, tampons, helpers. Aucune bibliothèque. */

export function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

/** Quad instancié : un rectangle monde par instance, coins (0..1) partagés. */
const QUAD_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_rect;
layout(location=2) in vec4 a_uv;
layout(location=3) in vec4 a_color;
uniform vec4 u_cam;   // x, y, zoom
uniform vec2 u_view;  // taille de la vue en px CSS
out vec2 v_uv;
out vec4 v_color;
out vec2 v_local;
out vec2 v_size;
void main() {
  vec2 w = a_rect.xy + a_corner * a_rect.zw;
  vec2 s = (w - u_cam.xy) * u_cam.z + u_view * 0.5;
  vec2 ndc = s / u_view * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
  v_color = a_color;
  v_local = a_corner * a_rect.zw;
  v_size = a_rect.zw;
}`;

/** Tuile pleine à coins arrondis (SDF), couleur prémultipliée. */
const TILE_FS = `#version 300 es
precision mediump float;
in vec2 v_local; in vec2 v_size; in vec4 v_color;
uniform float u_zoom; uniform float u_radius;
out vec4 o;
void main() {
  // arrondi sous le pixel : aplat (évite le SDF par pixel, coûteux en WebGL logiciel)
  if (u_radius * u_zoom < 1.5) { o = v_color; return; }
  vec2 p = v_local - v_size * 0.5;
  vec2 q = abs(p) - v_size * 0.5 + u_radius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
  float a = clamp(0.5 - d * u_zoom, 0.0, 1.0);
  o = v_color * a;
}`;

/** Quad texturé (texture de carte capturée), alpha global pour le fondu. */
const TEX_FS = `#version 300 es
precision mediump float;
in vec2 v_uv; in vec4 v_color;
uniform sampler2D u_tex;
out vec4 o;
void main() { o = texture(u_tex, v_uv) * v_color.a; }`;

/** Segments de sparkline : triangles en coordonnées monde. */
const LINE_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_color;
uniform vec4 u_cam; uniform vec2 u_view;
out vec4 v_color;
void main() {
  vec2 s = (a_pos - u_cam.xy) * u_cam.z + u_view * 0.5;
  vec2 ndc = s / u_view * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  v_color = a_color;
}`;
const LINE_FS = `#version 300 es
precision mediump float;
in vec4 v_color; out vec4 o;
void main() { o = v_color; }`;

export const INSTANCE_FLOATS = 12; // rect(4) + uv(4) + color(4)

export class Programs {
  tile: WebGLProgram;
  tex: WebGLProgram;
  line: WebGLProgram;
  quadVao: WebGLVertexArrayObject;
  instBuf: WebGLBuffer;
  lineVao: WebGLVertexArrayObject;
  lineBuf: WebGLBuffer;
  private u = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext) {
    this.tile = compile(gl, QUAD_VS, TILE_FS);
    this.tex = compile(gl, QUAD_VS, TEX_FS);
    this.line = compile(gl, LINE_VS, LINE_FS);
    // VAO du quad instancié
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer()!;
    this.bindInstances(0);
    gl.bindVertexArray(null);
    // VAO des lignes
    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    this.lineBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);
  }

  /**
   * (Re)pointe les attributs d'instance à partir de l'instance `first` : WebGL2 n'a pas de
   * baseInstance, on décale donc l'offset des pointeurs (utile pour « une texture par carte »).
   */
  bindInstances(first: number) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    const stride = INSTANCE_FLOATS * 4;
    const base = first * stride;
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, stride, base + i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
  }

  loc(p: WebGLProgram, name: string) {
    const key = `${name}@${this.progName(p)}`;
    if (!this.u.has(key)) this.u.set(key, this.gl.getUniformLocation(p, name));
    return this.u.get(key)!;
  }
  private progName(p: WebGLProgram) {
    return p === this.tile ? "tile" : p === this.tex ? "tex" : "line";
  }

  setCamera(p: WebGLProgram, x: number, y: number, zoom: number, vw: number, vh: number) {
    const gl = this.gl;
    gl.uniform4f(this.loc(p, "u_cam"), x, y, zoom, 0);
    gl.uniform2f(this.loc(p, "u_view"), vw, vh);
  }
}
