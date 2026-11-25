/**
 * Export vidéo : canvas.captureStream() + MediaRecorder. Seul ce qui est dessiné DANS le canvas
 * est enregistré : en mode HTML-in-Canvas les panneaux y sont, en mode classique (popups DOM) non.
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

export async function recordMap(map: MlMap, ms = 10_000, fps = 30): Promise<Recording> {
  if (!canRecord()) throw new Error("enregistrement du canvas non pris en charge par ce navigateur");
  const canvas = map.getCanvas() as HTMLCanvasElement & { captureStream(fps?: number): MediaStream };
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  // le flux ne reçoit une image que si le canvas est redessiné : on force le rendu pendant l'enregistrement
  let raf = 0;
  const pump = () => {
    map.triggerRepaint();
    raf = requestAnimationFrame(pump);
  };
  const t0 = performance.now();
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  rec.start(500);
  pump();
  await new Promise((r) => setTimeout(r, ms));
  rec.stop();
  await done;
  cancelAnimationFrame(raf);
  stream.getTracks().forEach((t) => t.stop());
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
