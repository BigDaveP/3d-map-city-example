/**
 * Enveloppe de l'API HTML-in-Canvas autour d'un <canvas> WebGL2 :
 *  - attributs (content="drawable" + layoutsubtree pour les anciennes versions) ;
 *  - upload d'un élément dans une texture (API actuelle ou ancienne) ;
 *  - vérification des pixels (piège : API présente mais aucun pixel transmis) ;
 *  - géométrie pour le hit testing (updateElementGeometry ou getElementTransform).
 */
import { detectApi, type ApiSupport } from "./detect";

type AnyCanvas = HTMLCanvasElement & {
  requestPaint?: () => void;
  captureElementImage?: (el: Element) => { close?: () => void } | null;
  updateElementGeometry?: (el: Element, o: { canvasTransform: DOMMatrix }) => void;
  getElementTransform?: (el: Element, m: DOMMatrix) => DOMMatrix;
};
type AnyGL = WebGL2RenderingContext & {
  texElementSubImage2D?: (target: number, level: number, x: number, y: number, el: Element) => void;
  texElementImage2D?: (target: number, level: number, internal: number, format: number, type: number, el: Element) => void;
};

export interface VerifyResult {
  ok: boolean;
  samples: number[][];
}

export class HicSurface {
  readonly canvas: AnyCanvas;
  readonly gl: AnyGL;
  readonly api: ApiSupport;
  private fbo: WebGLFramebuffer;
  paints = 0;
  firstPaintAt = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas as AnyCanvas;
    canvas.setAttribute("content", "drawable");
    canvas.setAttribute("layoutsubtree", "");
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 indisponible");
    this.gl = gl as AnyGL;
    this.api = detectApi();
    this.fbo = gl.createFramebuffer()!;
  }

  /** Rapport pixels du backing store / px CSS : la capture d'un élément a cette échelle. */
  get scale() {
    return this.canvas.clientWidth ? this.canvas.width / this.canvas.clientWidth : 1;
  }

  /** Ajuste le backing store à la taille CSS x devicePixelRatio. Renvoie true si changé. */
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  requestPaint() {
    this.canvas.requestPaint?.();
  }

  /**
   * Taille en texels de la capture d'un élément. `captureElementImage` ne donne pas sa taille
   * (l'objet ElementImage n'expose que close()) : on la calcule depuis offsetWidth/Height.
   */
  texelSize(el: HTMLElement): [number, number] {
    const s = this.scale;
    const w = el.offsetWidth || Number.parseFloat(el.style.width) || 1;
    const h = el.offsetHeight || Number.parseFloat(el.style.height) || 1;
    return [Math.max(1, Math.ceil(w * s)), Math.max(1, Math.ceil(h * s))];
  }

  /** Alloue une texture vide de taille non nulle. */
  allocTexture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, Math.max(1, w), Math.max(1, h), 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /**
   * Copie le rendu de `el` dans `tex` à (x, y). À appeler dans le handler `paint` (en dehors,
   * Chrome lève « No cached paint record for element » tant qu'aucun paint n'a eu lieu).
   * Renvoie false si l'upload a échoué (erreur GL ou exception).
   */
  upload(el: Element, tex: WebGLTexture, x: number, y: number): { ok: boolean; error?: string } {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      if (this.api.upload === "texElementSubImage2D") {
        gl.texElementSubImage2D!(gl.TEXTURE_2D, 0, x, y, el);
      } else if (this.api.upload === "texElementImage2D") {
        // ancienne API : alloue et remplit la texture entière (pas d'atlas possible)
        gl.texElementImage2D!(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      } else return { ok: false, error: "API absente" };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const err = gl.getError();
    // INVALID_VALUE : la texture est plus petite que la capture => rien n'est copié (texture noire)
    return err === gl.NO_ERROR ? { ok: true } : { ok: false, error: `erreur GL 0x${err.toString(16)}` };
  }

  /** Lit quelques texels de la zone (x, y, w, h) d'une texture. Coûteux (synchronisation GPU). */
  verify(tex: WebGLTexture, x: number, y: number, w: number, h: number): VerifyResult {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const pts = [
      [0.5, 0.5],
      [0.25, 0.5],
      [0.75, 0.5],
      [0.5, 0.2],
      [0.5, 0.8],
    ];
    const px = new Uint8Array(4);
    const samples: number[][] = [];
    for (const [fx, fy] of pts) {
      gl.readPixels(x + Math.floor(w * fx), y + Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      samples.push(Array.from(px));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // une carte a un fond opaque : au moins un échantillon doit avoir alpha > 0 et ne pas être noir pur
    const ok = samples.some((s) => s[3] > 0 && s[0] + s[1] + s[2] > 0);
    return { ok, samples };
  }

  /** Transformation élément (px CSS) -> canvas (px CSS) pour le hit testing. */
  setGeometry(el: HTMLElement, m: DOMMatrix) {
    if (this.api.geometry === "updateElementGeometry") this.canvas.updateElementGeometry!(el, { canvasTransform: m });
    else if (this.api.geometry === "getElementTransform") el.style.transform = this.canvas.getElementTransform!(el, m).toString();
  }
}

/**
 * Vérifie empiriquement l'unité attendue par `canvasTransform` : on crée un canvas dont le
 * backing store vaut 2x sa taille CSS, on translate un enfant de (40, 20) et on mesure.
 */
export function probeGeometryUnit(): "px CSS" | "px backing store" | "inconnue" {
  const api = detectApi();
  if (api.geometry !== "updateElementGeometry") return "inconnue";
  const c = document.createElement("canvas") as AnyCanvas;
  c.setAttribute("content", "drawable");
  c.setAttribute("layoutsubtree", "");
  c.style.cssText = "position:fixed;left:0;top:0;width:100px;height:100px;opacity:0;pointer-events:none";
  c.width = 200;
  c.height = 200;
  const d = document.createElement("div");
  d.setAttribute("drawable", "");
  d.style.cssText = "width:10px;height:10px";
  c.appendChild(d);
  document.body.appendChild(c);
  try {
    c.updateElementGeometry!(d, { canvasTransform: new DOMMatrix().translate(40, 20) });
    const cr = c.getBoundingClientRect();
    const r = d.getBoundingClientRect();
    const dx = r.left - cr.left;
    if (Math.abs(dx - 40) < 1) return "px CSS";
    if (Math.abs(dx - 20) < 1) return "px backing store";
    return "inconnue";
  } finally {
    c.remove();
  }
}
