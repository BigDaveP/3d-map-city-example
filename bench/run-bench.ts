/**
 * Banc de mesures reproductible.
 *
 *   npm run build && PORT=3100 npm start &
 *   BASE_URL=http://localhost:3100 npm run bench
 *
 * Pour chaque nombre de cartes (250, 500, 1000) et chaque configuration (DOM, canvas + atlas,
 * canvas + une texture par carte), joue le même parcours à vitesse x10 et enregistre par phase :
 * FPS, temps de frame p50/p95, temps JS, latence donnée -> pixel, captures, file, mémoire.
 * Sorties : bench/results/results.csv et bench/results/meta.json (lus par la page /bench).
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const COUNTS = (process.env.COUNTS ?? "250,500,1000").split(",").map(Number);
const CONFIGS = (process.env.CONFIGS ?? "dom,canvas-atlas,canvas-percard").split(",");
const REPEAT = Number(process.env.REPEAT ?? 1);
const SPEEDS = (process.env.SPEEDS ?? "10").split(",").map(Number);
// budgets de recapture « captures:ms » (modes canvas uniquement)
const BUDGETS = (process.env.BUDGETS ?? "12:6").split(",").map((b) => b.split(":").map(Number) as [number, number]);
const CAMPAIGN = process.env.CAMPAIGN ?? "principal";
const OUT = process.env.OUT ?? "bench/results";
// Équivalent ligne de commande de chrome://flags/#canvas-draw-element (inoffensif si déjà actif)
// --enable-precise-memory-info : sans lui, performance.memory est quantifié (valeur figée)
const CHROME_ARGS = ["--enable-blink-features=CanvasDrawElement", "--enable-precise-memory-info"];
const VIEWPORT = { width: 1600, height: 900 };

type Row = Record<string, string | number>;
const COLUMNS = [
  "campaign", "n", "config", "speed", "budget", "rep", "phase", "durationMs", "frames", "fps", "frameP50", "frameP95", "workP50", "workP95",
  "latP50", "latP95", "latSamples", "capturesTotal", "capturesPerFrame", "captureMsAvg", "queueMax", "gpuMB", "heapMB", "domNodes", "mounted",
];


async function phase(p: Page, name: string, body: () => Promise<void>): Promise<Row> {
  await p.evaluate((n) => (window as any).__wall.beginPhase(n), name);
  await body();
  const r = await p.evaluate(() => (window as any).__wall.endPhase());
  return r as Row;
}

const fly = (p: Page, target: string, dur: number) => p.evaluate(`(async () => { const w = window.__wall; const t = (${target})(w); await w.flyTo(t, ${dur}); })()`);

async function runOne(n: number, config: string, rep: number, speed: number, budget: [number, number]): Promise<Row[]> {
  const b = await chromium.launch({ args: CHROME_ARGS });
  const p = await b.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const mode = config === "dom" ? "dom" : "canvas";
  await p.goto(`${BASE}/?mode=${mode}&n=${n}`);
  await p.waitForFunction(() => (window as any).__wall, null, { timeout: 60_000 });
  await p.evaluate(([atlas, maxCaptures, maxMs]) => (window as any).__wall.ui.setState({ atlas, maxCaptures, maxMs }), [config !== "canvas-percard", budget[0], budget[1]] as const);
  await p.evaluate((s) => (window as any).__wall.actions.setSpeed(s), speed);
  await p.waitForTimeout(2500);
  const actual = await p.evaluate(() => (window as any).__wall.ui.getState().mode);
  if (actual !== mode) throw new Error(`mode ${mode} demandé, ${actual} actif (${await p.evaluate(() => (window as any).__wall.ui.getState().fallback)})`);

  const rows: Row[] = [];
  const hold = (ms: number) => p.waitForTimeout(ms);
  // 1. vue d'ensemble
  rows.push(await phase(p, "1-vue-ensemble", async () => {
    await fly(p, "(w) => w.fit(w.layout.bounds)", 0);
    await hold(3000);
  }));
  // 2. zoom sur une région (niveau intermédiaire)
  rows.push(await phase(p, "2-zoom-region", async () => {
    await fly(p, "(w) => { const r = w.regionRect(0); return { x: r.x + r.w * 0.25, y: r.y + r.h * 0.12, zoom: 0.35 }; }", 1500);
    await hold(500);
  }));
  // 3. pan sur toute la région (serpentin)
  rows.push(await phase(p, "3-pan-region", async () => {
    const pts = [[0.75, 0.12], [0.75, 0.38], [0.25, 0.38], [0.25, 0.64], [0.75, 0.64], [0.75, 0.9], [0.25, 0.9]];
    for (const [fx, fy] of pts) await fly(p, `(w) => { const r = w.regionRect(0); return { x: r.x + r.w * ${fx}, y: r.y + r.h * ${fy} }; }`, 900);
    await hold(300);
  }));
  // 4. zoom sur une carte (niveau rapproché)
  rows.push(await phase(p, "4-zoom-carte", async () => {
    await fly(p, "(w) => { const r = w.cardRect(0); return { x: r.x + r.w * 1.4, y: r.y + r.h * 1.3, zoom: 1 }; }", 1500);
    await hold(500);
  }));
  // 5. saisie dans la note
  rows.push(await phase(p, "5-saisie-note", async () => {
    const ta = p.locator('textarea[data-note="S001:sales"]');
    await ta.click();
    await p.keyboard.press("Control+A");
    await p.keyboard.type(`Banc ${config} ${n} : rupture de stock caisse 2, relance fournisseur.`, { delay: 30 });
    await hold(300);
  }));
  // 6. dézoom
  rows.push(await phase(p, "6-dezoom", async () => {
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fly(p, "(w) => w.fit(w.layout.bounds)", 1500);
    await hold(500);
  }));
  // 7. tempête (vue d'ensemble)
  rows.push(await phase(p, "7-tempete", async () => {
    await p.evaluate(() => (window as any).__wall.storm(4242));
    await hold(3000);
  }));
  // 8. (supplément) tempête au niveau intermédiaire : 30 % des cartes visibles à recapturer
  rows.push(await phase(p, "8-tempete-region", async () => {
    await fly(p, "(w) => { const r = w.regionRect(0); return { x: r.x + r.w * 0.25, y: r.y + r.h * 0.12, zoom: 0.35 }; }", 0);
    await hold(1500);
    await p.evaluate(() => (window as any).__wall.storm(4343));
    await hold(3000);
  }));
  if (errors.length) console.warn(`  erreurs JS : ${errors.join(" | ")}`);
  await b.close();
  const budgetLabel = config === "dom" ? "-" : `${budget[0]}:${budget[1]}`;
  return rows.map((r) => ({ campaign: CAMPAIGN, n, config, speed, budget: budgetLabel, rep, ...r }));
}

function summarize(rows: Row[]): Row {
  // parcours complet : moyennes pondérées par le nombre de frames, maxima pour la mémoire
  const frames = rows.reduce((a, r) => a + Number(r.frames), 0);
  const w = (k: string) => rows.reduce((a, r) => a + Number(r[k]) * Number(r.frames), 0) / Math.max(1, frames);
  const max = (k: string) => Math.max(...rows.map((r) => Number(r[k])));
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k]), 0);
  const lat = rows.filter((r) => Number(r.latSamples) > 0);
  const lw = (k: string) => lat.reduce((a, r) => a + Number(r[k]) * Number(r.latSamples), 0) / Math.max(1, sum("latSamples"));
  return {
    ...rows[0],
    phase: "0-parcours-complet",
    durationMs: sum("durationMs"),
    frames,
    fps: w("fps"),
    frameP50: w("frameP50"),
    frameP95: max("frameP95"),
    workP50: w("workP50"),
    workP95: max("workP95"),
    latP50: lw("latP50"),
    latP95: lat.length ? Math.max(...lat.map((r) => Number(r.latP95))) : 0,
    latSamples: sum("latSamples"),
    capturesTotal: sum("capturesTotal"),
    capturesPerFrame: sum("capturesTotal") / Math.max(1, frames),
    captureMsAvg: rows.reduce((a, r) => a + Number(r.captureMsAvg) * Number(r.capturesTotal), 0) / Math.max(1, sum("capturesTotal")),
    queueMax: max("queueMax"),
    gpuMB: max("gpuMB"),
    heapMB: max("heapMB"),
    domNodes: max("domNodes"),
    mounted: max("mounted"),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const all: Row[] = [];
  for (let rep = 1; rep <= REPEAT; rep++) {
    for (const speed of SPEEDS) {
      for (const n of COUNTS) {
        for (const config of CONFIGS) {
          for (const budget of config === "dom" ? [BUDGETS[0]] : BUDGETS) {
            const t0 = Date.now();
            process.stdout.write(`n=${n} ${config} x${speed} budget=${budget.join(":")} rep=${rep} … `);
            const rows = await runOne(n, config, rep, speed, budget);
            const s = summarize(rows);
            all.push(s, ...rows);
            console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s — fps ${Number(s.fps).toFixed(1)}, p95 ${Number(s.frameP95).toFixed(1)} ms, captures ${s.capturesTotal}`);
          }
        }
      }
    }
  }
  const fmt = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v));
  const csv = [COLUMNS.join(","), ...all.map((r) => COLUMNS.map((c) => fmt(r[c])).join(","))].join("\n") + "\n";
  // APPEND=1 : ajoute à un CSV existant (campagnes complémentaires)
  const file = `${OUT}/results.csv`;
  if (process.env.APPEND === "1" && existsSync(file)) appendFileSync(file, csv.slice(csv.indexOf("\n") + 1));
  else writeFileSync(file, csv);

  const b = await chromium.launch({ args: CHROME_ARGS });
  const p = await b.newPage();
  const renderer = await p.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const e = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "aucun WebGL2";
  });
  // étalon : canvas WebGL2 plein écran qui ne fait que clear() à chaque frame (coût plateforme)
  const p2 = await b.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await p2.setContent(`<body style="margin:0"><canvas style="width:100vw;height:100vh;display:block"></canvas></body>`);
  // script passé en chaîne : tsx/esbuild injecte sinon un helper __name absent de la page
  const glBaseline = await p2.evaluate(`(async () => {
    const c = document.querySelector("canvas");
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    const gl = c.getContext("webgl2", { alpha: false, antialias: false });
    function run(draw) {
      return new Promise(function (resolve) {
        const d = [];
        let last = 0;
        const t0 = performance.now();
        function f(t) {
          if (last) d.push(t - last);
          last = t;
          if (draw) { gl.clearColor(Math.random(), 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
          if (t - t0 < 3000) requestAnimationFrame(f);
          else {
            d.sort(function (x, y) { return x - y; });
            resolve({ fps: 1000 / (d.reduce(function (x, y) { return x + y; }, 0) / d.length), p95: d[Math.floor(d.length * 0.95)] });
          }
        }
        requestAnimationFrame(f);
      });
    }
    return { sansDessin: await run(false), clearChaqueFrame: await run(true), taille: c.width + "×" + c.height };
  })()`);
  const meta = {
    date: new Date().toISOString(),
    browser: `Chromium ${b.version()} (Playwright, headless)`,
    chromeArgs: CHROME_ARGS,
    webgl: renderer,
    glBaseline,
    cpu: `${os.cpus()[0]?.model ?? "?"} × ${os.cpus().length}`,
    memoryGB: Math.round(os.totalmem() / 1e9),
    viewport: VIEWPORT,
    repeat: REPEAT,
  };
  await b.close();
  if (process.env.APPEND !== "1") writeFileSync(`${OUT}/meta.json`, JSON.stringify({ ...meta, speed: SPEEDS, budget: BUDGETS }, null, 2) + "\n");
  console.log(`\nÉcrit : ${OUT}/results.csv (${all.length} lignes), ${OUT}/meta.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
