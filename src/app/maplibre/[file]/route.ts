/**
 * Sert le worker de MapLibre 6 tel qu'il est publié. Par défaut, MapLibre le charge via
 * `new URL("./maplibre-gl-worker.mjs", import.meta.url)` : Turbopack réécrit cette URL et, en
 * développement, le worker relançait le rechargement à chaud de la page en boucle.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!ALLOWED.has(file)) return new Response("introuvable", { status: 404 });
  const body = await readFile(path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", file), "utf8");
  return new Response(body, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" } });
}
