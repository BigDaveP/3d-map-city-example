/**
 * Banc de la carte 3D : mode classique vs HTML-in-Canvas, 10 / 30 / 60 panneaux ouverts.
 *
 *   npm run build && PORT=3100 npm start
 *   BASE_URL=http://localhost:3100 npm run bench:carte
 *
 * Parcours par configuration : chauffe 4 s, rotation de 90° en 8 s, puis 12 s immobile avec
 * les données en direct (livreurs, statuts). Mesures : FPS, temps de frame p50/p95, temps JS
 * p95 par frame, captures par minute, latence d'un changement de statut jusqu'au pixel ; en
 * HTML-in-Canvas, coût des requêtes d'occlusion au survol.
 * Sorties : bench/results/carte.csv et bench/results/carte-meta.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.OUT ?? "bench/results";
const COUNTS = (process.env.COUNTS ?? "10,30,60").split(",").map(Number);
const MODES = (process.env.MODES ?? "classic,hic").split(",") as ("classic" | "hic")[];
const REPEAT = Number(process.env.REPEAT ?? 1);
const VIEW = { width: Number(process.env.W ?? 1000), height: Number(process.env.H ?? 650) };
const ARGS = ["--enable-blink-features=CanvasDrawElement", "--enable-precise-memory-info"];
const CAM = { center: [-73.5672, 45.5045], zoom: 15.9, pitch: 62, bearing: -25 };

type Row = Record<string, string | number>;
const COLS = ["mode", "panels", "rep", "phase", "durationMs", "frames", "fps", "frameP50", "frameP95", "workP50", "workP95", "capturesTotal", "capturesPerMin", "captureMsAvg", "latP50", "latP95", "latSamples", "gpuMB", "heapMB", "domNodes", "occlQueries", "occlMsAvg"];

async function phase(p: Page, name: string, body: () => Promise<void>) {
  await p.evaluate((n) => (window as any).__carte.metrics.beginPhase(n), name);
  await body();
  const r = await p.evaluate(() => (window as any).__carte.metrics.endPhase());
  return { ...r, capturesPerMin: (r.capturesTotal * 60000) / r.durationMs } as Row;
}

async function runOne(mode: "classic" | "hic", n: number, rep: number): Promise<Row[]> {
  const b = await chromium.launch({ args: ARGS });
  const p = await b.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/carte?mode=${mode}`);
  await p.waitForFunction(() => (window as any).__carte, null, { timeout: 60_000 });
  await p.evaluate(
    ([cam, n]) => {
      const c = (window as any).__carte;
      c.store.setState({ transition: "none", pulse: true });
      c.map.jumpTo(cam);
      c.openPanels(Math.min(30, n as number), Math.max(0, (n as number) - 30));
    },
    [CAM, n] as const,
  );
  await p.waitForFunction(() => (window as any).__map.areTilesLoaded(), null, { timeout: 60_000 }).catch(() => {});
  await p.waitForTimeout(4000);
  const actual = await p.evaluate(() => (window as any).__carte.store.getState().mode);
  if (actual !== mode) throw new Error(`mode ${mode} demandé, ${actual} actif`);
  const rows: Row[] = [];
  rows.push(
    await phase(p, "1-rotation", async () => {
      await p.evaluate(() => new Promise<void>((r) => { const m = (window as any).__map; m.once("moveend", () => r()); m.easeTo({ bearing: m.getBearing() + 90, duration: 8000 }); }));
    }),
  );
  rows.push(await phase(p, "2-immobile-donnees", () => p.waitForTimeout(12_000)));
  // coût du hit testing avec occlusion : survol de chaque panneau visible
  let occl = { queries: 0, ms: 0 };
  if (mode === "hic") {
    const pts = await p.evaluate(() => {
      const L = (window as any).__hicMap.layer;
      const out: [number, number][] = [];
      for (const pn of L.panels.values()) if (pn.proj) { const [x, y] = pn.proj.project(pn.w / 2, pn.h / 2); if (x > 0 && y > 0 && x < innerWidth && y < innerHeight) out.push([x, y]); }
      return out.slice(0, 10);
    });
    const before = await p.evaluate(() => ({ ...(window as any).__occlusion }));
    const box = (await p.locator(".maplibregl-canvas").boundingBox())!;
    for (const [x, y] of pts) {
      await p.mouse.move(box.x + x, box.y + y);
      await p.waitForTimeout(600);
    }
    const after = await p.evaluate(() => ({ ...(window as any).__occlusion }));
    occl = { queries: after.queries - before.queries, ms: (after.totalMs - before.totalMs) / Math.max(1, after.queries - before.queries) };
  }
  if (errors.length) console.warn(`  erreurs JS : ${errors.join(" | ")}`);
  await b.close();
  return rows.map((r) => ({ mode, panels: n, rep, ...r, occlQueries: occl.queries, occlMsAvg: occl.ms }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const all: Row[] = [];
  for (let rep = 1; rep <= REPEAT; rep++)
    for (const n of COUNTS)
      for (const mode of MODES) {
        const t0 = Date.now();
        process.stdout.write(`${mode} ${n} panneaux rep=${rep} … `);
        const rows = await runOne(mode, n, rep);
        all.push(...rows);
        const r = rows[0];
        console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s — rotation : ${Number(r.fps).toFixed(1)} FPS, JS p95 ${Number(r.workP95).toFixed(1)} ms, ${Number(rows[1].capturesPerMin).toFixed(0)} captures/min au repos`);
      }
  const fmt = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v ?? ""));
  writeFileSync(`${OUT}/carte.csv`, [COLS.join(","), ...all.map((r) => COLS.map((c) => fmt(r[c])).join(","))].join("\n") + "\n");
  const b = await chromium.launch({ args: ARGS });
  const p = await b.newPage();
  const webgl = await p.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2"); const e = gl && gl.getExtension("WEBGL_debug_renderer_info"); return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "aucun WebGL2"; })()`);
  writeFileSync(
    `${OUT}/carte-meta.json`,
    JSON.stringify({ date: new Date().toISOString(), browser: `Chromium ${b.version()}`, webgl, gpu: !/SwiftShader|llvmpipe|software/i.test(String(webgl)), cpu: `${os.cpus()[0]?.model} × ${os.cpus().length}`, viewport: VIEW, camera: CAM, repeat: REPEAT }, null, 2) + "\n",
  );
  await b.close();
  console.log(`Écrit : ${OUT}/carte.csv, ${OUT}/carte-meta.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
