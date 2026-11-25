/**
 * Détection de l'API HTML-in-Canvas, noms actuels (Chrome 155+) et anciens.
 *
 * | Ancien                              | Actuel                                                      |
 * | <canvas layoutsubtree>              | <canvas content="drawable"> + `drawable` sur les enfants    |
 * | gl.texElementImage2D(..., el)       | gl.texImage2D(..., null) puis gl.texElementSubImage2D(...)   |
 * | canvas.getElementTransform(el, m)   | canvas.updateElementGeometry(el, { canvasTransform })       |
 */
export interface ApiSupport {
  present: boolean;
  upload: "texElementSubImage2D" | "texElementImage2D" | null;
  geometry: "updateElementGeometry" | "getElementTransform" | null;
  captureElementImage: boolean;
  requestPaint: boolean;
  paintEvent: boolean;
  detail: string;
}

export function detectApi(): ApiSupport {
  if (typeof window === "undefined" || typeof WebGL2RenderingContext === "undefined") {
    return { present: false, upload: null, geometry: null, captureElementImage: false, requestPaint: false, paintEvent: false, detail: "WebGL2 indisponible" };
  }
  const C = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const G = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
  const upload = typeof G.texElementSubImage2D === "function" ? "texElementSubImage2D" : typeof G.texElementImage2D === "function" ? "texElementImage2D" : null;
  const geometry = typeof C.updateElementGeometry === "function" ? "updateElementGeometry" : typeof C.getElementTransform === "function" ? "getElementTransform" : null;
  const s: ApiSupport = {
    present: !!upload,
    upload,
    geometry,
    captureElementImage: typeof C.captureElementImage === "function",
    requestPaint: typeof C.requestPaint === "function",
    paintEvent: "onpaint" in HTMLCanvasElement.prototype,
    detail: "",
  };
  s.detail = s.present
    ? `${upload}${geometry ? ` + ${geometry}` : ""}${s.requestPaint ? " + requestPaint" : ""}`
    : "ni texElementSubImage2D ni texElementImage2D (activez chrome://flags/#canvas-draw-element)";
  return s;
}
