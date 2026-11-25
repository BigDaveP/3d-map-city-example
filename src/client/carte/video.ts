/**
 * Export vidéo : MediaRecorder sur un canvas 2D qui recopie, à chaque rendu de la carte, le canvas
 * WebGL et lui ajoute un bandeau de crédits (attribution des données, fond de carte, mention
 * « simulation »). Le contrôle d'attribution de MapLibre est du DOM : sans ce bandeau, aucun fichier
 * exporté ne créditerait ses sources. Seul ce qui est dessiné DANS le canvas de la carte est
 * enregistré : en mode HTML-in-Canvas les panneaux y sont, en mode classique (popups DOM) non.
 */
import type { Map as MlMap } from "maplibre-gl";

export interface Recording {
  url: string;
  size: number;
  mime: string;
  ms: number;
}

/** Vrai si le navigateur sait enregistrer un canvas (MediaRecorder et canvas.captureStream). */
export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

/** Contexte 2D réduit à ce que le bandeau utilise (testable sans navigateur). */
type Ctx2D = Pick<CanvasRenderingContext2D, "font" | "fillStyle" | "textBaseline" | "fillRect" | "fillText" | "measureText">;

/** Corps du texte du bandeau (px du canvas) : lisible à la largeur de la vidéo, entre 12 et 20 px. */
export const creditFontPx = (w: number) => Math.max(12, Math.min(20, Math.round(w / 90)));
const font = (px: number) => `600 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/**
 * Lignes du bandeau : chaque crédit sur sa ligne, coupé aux espaces s'il dépasse `maxW` (mesuré par
 * `measure`). Un mot plus long que la ligne reste entier.
 */
export function wrapCredits(credits: readonly string[], maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const c of credits) {
    let line = "";
    for (const word of c.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxW) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

/** Hauteur (px, paire pour l'encodeur) du bandeau pour ces lignes. */
export const stripHeight = (lines: number, px: number) => {
  const h = Math.round(lines * px * 1.35 + px * 1.1);
  return h + (h % 2);
};

/** Dessine le bandeau (fond sombre, texte clair) sur [y, y + h] de la largeur w. */
export function drawCredits(c: Ctx2D, lines: readonly string[], w: number, y: number, h: number, px: number) {
  c.fillStyle = "#142133";
  c.fillRect(0, y, w, h);
  c.fillStyle = "#ffffff";
  c.font = font(px);
  c.textBaseline = "top";
  lines.forEach((l, i) => c.fillText(l, Math.round(px * 0.8), Math.round(y + px * 0.55 + i * px * 1.35)));
}

/**
 * Enregistre `ms` de la carte avec, sous l'image, le bandeau `credits` (une entrée par crédit,
 * coupée au besoin). Le canvas 2D est redessiné à l'événement « render » de MapLibre : le tampon
 * WebGL y est encore lisible (preserveDrawingBuffer: false le vide après composition).
 */
export async function recordMap(map: MlMap, credits: readonly string[], ms = 10_000, fps = 30): Promise<Recording> {
  if (!canRecord()) throw new Error("enregistrement du canvas non pris en charge par ce navigateur");
  const src = map.getCanvas();
  const out = document.createElement("canvas") as HTMLCanvasElement & { captureStream(fps?: number): MediaStream };
  const c = out.getContext("2d");
  if (!c) throw new Error("canvas 2D indisponible");
  let w = 0;
  let h = 0;
  let lines: string[] = [];
  let px = 12;
  let strip = 0;
  const frame = () => {
    // la carte peut changer de taille pendant l'enregistrement : le bandeau suit sa largeur
    if (src.width !== w || src.height !== h) {
      w = src.width - (src.width % 2);
      h = src.height - (src.height % 2);
      px = creditFontPx(w);
      c.font = font(px);
      lines = wrapCredits(credits, w - px * 1.6, (s) => c.measureText(s).width);
      strip = stripHeight(lines.length, px);
      out.width = w;
      out.height = h + strip;
    }
    c.drawImage(src, 0, 0, w, h, 0, 0, w, h);
    drawCredits(c, lines, w, h, strip, px);
  };
  frame();
  map.on("render", frame);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const stream = out.captureStream(fps);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  // le flux ne reçoit une image que si la carte est redessinée : on force le rendu pendant l'enregistrement
  let raf = 0;
  const pump = () => {
    map.triggerRepaint();
    raf = requestAnimationFrame(pump);
  };
  const t0 = performance.now();
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  try {
    rec.start(500);
    pump();
    await new Promise((r) => setTimeout(r, ms));
    rec.stop();
    await done;
  } finally {
    cancelAnimationFrame(raf);
    map.off("render", frame);
    stream.getTracks().forEach((t) => t.stop());
  }
  if (!chunks.length) throw new Error("enregistrement vide : aucune image reçue");
  const blob = new Blob(chunks, { type: mime || "video/webm" });
  return { url: URL.createObjectURL(blob), size: blob.size, mime: blob.type, ms: performance.now() - t0 };
}

export function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
