/**
 * Banc de l'environnement Aqueduc (`/carte/aqueduc`) : mode classique vs HTML-in-Canvas, 20 / 60 / 120 étiquettes.
 *
 *   npm run build && npx next start -p 3300
 *   BASE_URL=http://localhost:3300 npm run bench:aqueduc
 *
 * Étiquettes : `window.__aqueduc.setTags(n)` (R7) montre n étiquettes, capteurs réels de la zone
 * d'abord, puis points de mesure supplémentaires simulés ; sans le filtre de pertinence ni le plafond
 * de 8 de l'usage normal.
 * Phases par configuration (après chauffe) : 1-rotation (90° en 8 s), 2-immobile (12 s, horloge ×60 :
 * les valeurs changent à chaque message), 3-scenario (les 5 étapes du scénario de bris, vannes
 * fermées à l'isolation). Puis, en HTML-in-Canvas à 60 étiquettes, vue souterraine × tubes
 * (maîtresses ou tout le réseau), phases 1 et 2 (le scénario coupe la vue souterraine).
 * Mesures : FPS, temps de frame p50/p95, temps JS par image p50/p95/max, temps JS des mises à jour
 * de données (message du flux une fois par seconde : setFeatureState des conduites, rendus React,
 * captures) p50/p95/max, captures par minute, latence lecture → pixel (de la réception SSE à l'image
 * qui l'affiche, hors première capture d'une étiquette), occlusion au survol, instances de tubes.
 * L'horloge commune est épinglée à 12:00 de la journée de référence au début de chaque
 * configuration : les mesures ne dépendent pas de l'heure du lancement.
 * `SCALE` (défaut 1) multiplie les durées des phases ; les durées réelles sont dans le CSV et la méta.
 * Profil Chromium persistant (cache HTTP) : les tuiles OpenFreeMap ne sont téléchargées qu'une fois.
 * Sorties : bench/results/aqueduc.csv et bench/results/aqueduc-meta.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { atHour } from "../src/lib/territoire/day";

const BASE = process.env.BASE_URL ?? "http://localhost:3300";
const OUT = process.env.OUT ?? "bench/results";
const TAGS = (process.env.TAGS ?? "20,60,120").split(",").map(Number);
const MODES = (process.env.MODES ?? "classic,hic").split(",") as Mode[];
const REPEAT = Number(process.env.REPEAT ?? 2);
const SCALE = Number(process.env.SCALE ?? 1);
const UNDERGROUND = process.env.UNDERGROUND !== "0";
const VIEW = { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 800) };
const ARGS = ["--enable-blink-features=CanvasDrawElement", "--enable-precise-memory-info"];
const PROFILE = process.env.PROFILE ?? path.join(os.tmpdir(), "aqueduc-bench-profile");
/** Vue d'ouverture de la démo, un peu plus près : centre-ville de Trois-Rivières. */
const CAM = { center: [-72.5436, 46.3446], zoom: 15.6, pitch: 58, bearing: -25 };
const ROTATION_MS = Math.round(8000 * SCALE);
const IMMOBILE_MS = Math.round(12_000 * SCALE);
const STEP_DWELL_MS = Math.round(3000 * SCALE);
const WARMUP_MS = 4000;
/** Heure épinglée de chaque configuration : 12:00 de la journée de référence (avant le bris de 14:00). */
const NOON = atHour(SCENARIO_DAY, "12:00");

type Mode = "classic" | "hic";
type Tubes = "maitresses" | "tout";
type Row = Record<string, string | number>;
interface Config {
  mode: Mode;
  tags: number;
  underground: boolean;
  tubes: Tubes;
  phases: ("1-rotation" | "2-immobile" | "3-scenario")[];
}

const COLS = [
  "mode", "tags", "underground", "tubes", "rep", "phase", "durationMs", "fps", "frameP50", "frameP95", "workP50", "workP95",
  "capturesPerMin", "latP50", "latP95", "latSamples", "occlQueries", "occlMsAvg", "tubeInstances",
  // colonnes ajoutées : maximum par image, mises à jour de données (une par message du flux, par lot
  // d'étiquettes re-rendues hors message, par paint avec captures), totaux
  "workMax", "updates", "updP50", "updP95", "updMax", "updMsPerSec", "capturesTotal", "frames", "gpuMB", "heapMB", "domNodes", "mounted",
];

async function phase(p: Page, name: string, body: () => Promise<void>): Promise<Row> {
  await p.evaluate((n) => (window as any).__aqueduc.metrics.beginPhase(n), name);
  await body();
  const r = await p.evaluate(() => {
    const a = (window as any).__aqueduc;
    return { ...a.metrics.endPhase(), tubeInstances: a.tubes?.stats.instances ?? 0 };
  });
  // aucune latence mesurée : percentiles laissés vides (percentile([]) vaudrait 0, un faux chiffre)
  if (!r.latSamples) r.latP50 = r.latP95 = "";
  return { ...r, capturesPerMin: (r.capturesTotal * 60000) / r.durationMs } as Row;
}

/** Étiquettes à l'écran à la caméra de départ (emprise qui recoupe la carte), dans les deux modes. */
const tagsOnScreen = (p: Page) =>
  p.evaluate(() => {
    const w = window as any;
    const c = w.__aqueduc.map.getCanvas() as HTMLCanvasElement;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (w.__hicMap?.layer)
      return [...w.__hicMap.layer.panels.values()].filter((q: any) => {
        if (!q.key.startsWith("sensor:") || !q.proj) return false;
        const pts = [q.proj.project(0, 0), q.proj.project(q.w, 0), q.proj.project(0, q.h), q.proj.project(q.w, q.h)];
        const xs = pts.map((v: number[]) => v[0]);
        const ys = pts.map((v: number[]) => v[1]);
        return Math.max(...xs) > 0 && Math.min(...xs) < W && Math.max(...ys) > 0 && Math.min(...ys) < H;
      }).length;
    const box = c.getBoundingClientRect();
    return [...document.querySelectorAll(".aq-pin [data-sensor]")].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.right > box.left && b.left < box.right && b.bottom > box.top && b.top < box.bottom;
    }).length;
  });

const idle = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<void>((r) => {
        const m = (window as any).__aqueduc.map;
        if (m.loaded() && !m.isMoving()) return r();
        const t = setTimeout(r, 15_000);
        m.once("idle", () => (clearTimeout(t), r()));
      }),
  );

async function runOne(ctx: BrowserContext, c: Config, rep: number, errors: string[], onScreen: Record<string, number[]>): Promise<Row[]> {
  const p = await ctx.newPage();
  // tsx (esbuild, keepNames) enveloppe les fonctions nommées des callbacks dans __name
  await p.addInitScript("window.__name = (f) => f");
  p.on("pageerror", (e) => errors.push(`${c.mode}/${c.tags}: ${e.message}`));
  await p.goto(`${BASE}/carte/aqueduc?mode=${c.mode}`);
  await p.waitForFunction(() => (window as any).__aqueduc?.store.getState().live.t > 0, null, { timeout: 60_000 });
  // horloge épinglée, puis une lecture du flux à cette heure
  await p.evaluate((t) => (window as any).__territoire.store.setState({ clock: { t0: t, speed: 1, startedAt: Date.now() } }), NOON);
  await p.waitForFunction((t) => (window as any).__aqueduc.store.getState().live.t >= t, NOON, { timeout: 15_000 });
  await p.evaluate(
    ([cam, c]) => {
      const a = (window as any).__aqueduc;
      a.map.jumpTo(cam);
      a.setTags(c.tags);
      a.store.setState({ underground: c.underground, undergroundAll: c.tubes === "tout" });
    },
    [CAM, c] as const,
  );
  await idle(p);
  // étiquettes montées (et, en HTML-in-Canvas, toutes capturées une fois)
  await p
    .waitForFunction(
      ([mode, n]) => {
        const w = window as any;
        if (mode === "classic") return document.querySelectorAll(".aq-pin [data-sensor]").length >= n;
        const panels = [...(w.__hicMap?.layer?.panels.values() ?? [])].filter((q: any) => q.key.startsWith("sensor:"));
        return panels.length >= n && panels.every((q: any) => q.tex);
      },
      [c.mode, c.tags] as const,
      { timeout: 60_000 },
    )
    .catch(() => errors.push(`${c.mode}/${c.tags}: étiquettes pas toutes montées/capturées avant les mesures`));
  await p.waitForTimeout(WARMUP_MS);
  const st = await p.evaluate(() => {
    const w = window as any;
    const s = w.__aqueduc.territoire.getState();
    const tags = w.__hicMap?.layer ? [...w.__hicMap.layer.panels.keys()].filter((k: string) => k.startsWith("sensor:")).length : document.querySelectorAll(".aq-pin [data-sensor]").length;
    return { mode: s.mode, fallback: s.fallback, tags };
  });
  if (st.mode !== c.mode) throw new Error(`mode ${c.mode} demandé, ${st.mode} actif (${st.fallback})`);
  if (st.tags !== c.tags) errors.push(`${c.mode}/${c.tags}: ${st.tags} étiquettes montées`);
  if (!c.underground) (onScreen[`${c.mode}/${c.tags}`] ??= []).push(await tagsOnScreen(p));

  const rows: Row[] = [];
  let occl = { queries: 0, ms: 0 };
  for (const ph of c.phases) {
    if (ph === "1-rotation")
      rows.push(
        await phase(p, ph, () =>
          p.evaluate(
            (ms) =>
              new Promise<void>((r) => {
                const m = (window as any).__aqueduc.map;
                m.once("moveend", () => r());
                m.easeTo({ bearing: m.getBearing() + 90, duration: ms, easing: (t: number) => t });
              }),
            ROTATION_MS,
          ),
        ),
      );
    if (ph === "2-immobile") {
      rows.push(
        await phase(p, ph, async () => {
          await p.evaluate(() => {
            const { territoire } = (window as any).__aqueduc;
            const { clock } = territoire.getState();
            const now = Date.now();
            territoire.setState({ clock: { t0: clock.t0 + (now - clock.startedAt) * clock.speed, speed: 60, startedAt: now } });
          });
          await p.waitForTimeout(IMMOBILE_MS);
        }),
      );
      // coût du hit testing avec occlusion : survol de 10 étiquettes visibles (caméra immobile)
      if (c.mode === "hic") {
        const pts = await p.evaluate(() => {
          const L = (window as any).__hicMap?.layer;
          const out: [number, number][] = [];
          for (const q of L?.panels?.values() ?? [])
            if (q.key.startsWith("sensor:") && q.proj && q.visible) {
              const [x, y] = q.proj.project(q.w / 2, q.h / 2);
              if (x > 0 && y > 0 && x < innerWidth && y < innerHeight) out.push([x, y]);
            }
          return out.slice(0, 10);
        });
        const before = await p.evaluate(() => ({ queries: 0, totalMs: 0, ...(window as any).__occlusion }));
        const box = (await p.locator(".maplibregl-canvas").boundingBox())!;
        for (const [x, y] of pts) {
          await p.mouse.move(box.x + x, box.y + y);
          await p.waitForTimeout(600);
        }
        await p.mouse.move(2, VIEW.height - 2);
        const after = await p.evaluate(() => ({ queries: 0, totalMs: 0, ...(window as any).__occlusion }));
        const q = after.queries - before.queries;
        occl = { queries: q, ms: q ? (after.totalMs - before.totalMs) / q : 0 };
      }
    }
    if (ph === "3-scenario")
      rows.push(
        await phase(p, ph, async () => {
          for (const step of ["detection", "isolation", "close", "intervention", "retablissement", "rapport"]) {
            await p.evaluate((s) => (window as any).__aqueduc.play(s), step);
            await p.waitForTimeout(STEP_DWELL_MS);
          }
        }),
      );
  }
  const end = await p.evaluate(() => (window as any).__aqueduc.territoire.getState().mode);
  if (end !== c.mode) errors.push(`${c.mode}/${c.tags}: repli en cours de mesure (${end})`);
  await p.close();
  // occlusion (HTML-in-Canvas) mesurée entre les phases 2 et 3, caméra immobile : rapportée sur la ligne 2-immobile seulement
  return rows.map((r) => ({
    mode: c.mode, tags: c.tags, underground: String(c.underground), tubes: c.tubes, rep, ...r,
    ...(r.phase === "2-immobile" && c.mode === "hic" ? { occlQueries: occl.queries, occlMsAvg: occl.ms } : { occlQueries: "", occlMsAvg: "" }),
  }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const configs: Config[] = [];
  for (const tags of TAGS) for (const mode of MODES) configs.push({ mode, tags, underground: false, tubes: "maitresses", phases: ["1-rotation", "2-immobile", "3-scenario"] });
  if (UNDERGROUND && MODES.includes("hic"))
    for (const tubes of ["maitresses", "tout"] as Tubes[]) configs.push({ mode: "hic", tags: 60, underground: true, tubes, phases: ["1-rotation", "2-immobile"] });
  const all: Row[] = [];
  const errors: string[] = [];
  const onScreen: Record<string, number[]> = {};
  let browser = "";
  for (let rep = 1; rep <= REPEAT; rep++)
    for (const c of configs) {
      const t0 = Date.now();
      process.stdout.write(`${c.mode} ${c.tags} étiquettes${c.underground ? ` souterrain/${c.tubes}` : ""} rep=${rep} … `);
      const ctx = await chromium.launchPersistentContext(PROFILE, { args: ARGS, viewport: VIEW, deviceScaleFactor: 1 });
      browser = ctx.browser()?.version() ?? browser;
      try {
        const rows = await runOne(ctx, c, rep, errors, onScreen);
        all.push(...rows);
        const f = (r: Row | undefined, k: string, d = 1) => (r ? Number(r[k]).toFixed(d) : "-");
        const [rot, imm] = rows;
        console.log(
          `${((Date.now() - t0) / 1000).toFixed(0)} s — rotation ${f(rot, "fps")} i/s ; immobile ${f(imm, "fps")} i/s, JS/image p95 ${f(imm, "workP95")} max ${f(imm, "workMax")} ms, MAJ p95 ${f(imm, "updP95")} max ${f(imm, "updMax")} ms, ${f(imm, "capturesPerMin", 0)} captures/min, latence p50 ${f(imm, "latP50", 0)} ms (${f(imm, "latSamples", 0)})`,
        );
      } finally {
        await ctx.close();
      }
    }
  const fmt = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v ?? ""));
  writeFileSync(`${OUT}/aqueduc.csv`, [COLS.join(","), ...all.map((r) => COLS.map((c) => fmt(r[c])).join(","))].join("\n") + "\n");

  const ctx = await chromium.launchPersistentContext(PROFILE, { args: ARGS });
  const p = await ctx.newPage();
  const webgl = await p.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2"); const e = gl && gl.getExtension("WEBGL_debug_renderer_info"); return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "aucun WebGL2"; })()`);
  await ctx.close();
  const mean = (ph: string) => {
    const d = all.filter((r) => r.phase === ph).map((r) => Number(r.durationMs));
    return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : 0;
  };
  writeFileSync(
    `${OUT}/aqueduc-meta.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: `Chromium ${browser}`,
        flags: ARGS,
        webgl,
        gpu: !/SwiftShader|llvmpipe|software/i.test(String(webgl)),
        cpu: `${os.cpus()[0]?.model} × ${os.cpus().length}`,
        memoryGB: Math.round(os.totalmem() / 2 ** 30),
        viewport: VIEW,
        deviceScaleFactor: 1,
        camera: CAM,
        repeat: REPEAT,
        scale: SCALE,
        phases: {
          "1-rotation": { planned: `90° en ${ROTATION_MS} ms (linéaire)`, meanMs: mean("1-rotation") },
          "2-immobile": { planned: `${IMMOBILE_MS} ms, horloge ×60`, meanMs: mean("2-immobile") },
          "3-scenario": { planned: `5 étapes + fermeture des vannes, ${STEP_DWELL_MS} ms chacune`, meanMs: mean("3-scenario") },
        },
        warmupMs: WARMUP_MS,
        tubes: "souterrain=false : tubes non dessinés quel que soit le réglage, représenté par les lignes hic/60 ; souterrain=true mesuré pour maitresses et tout",
        latency: "réception SSE du message → image qui affiche la valeur : classique, requestAnimationFrame après le commit du DOM du marqueur ; HTML-in-Canvas, dessin qui suit l'upload de la texture de l'étiquette (HicHost, SurfaceSpec.changedAt) ; hors première capture ; inclut la cadence de 2 s des étiquettes (useThrottled) dans les deux modes ; étiquettes à l'écran seulement ; percentiles vides quand aucun échantillon. HTML-in-Canvas compte un échantillon par capture : une lecture remplacée avant sa capture n'est pas comptée (regroupement)",
        tagsOnScreen: Object.fromEntries(Object.entries(onScreen).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)])),
        tagsOnScreenNote: "étiquettes dont l'emprise recoupe la carte à la caméra de départ, après la chauffe (moyenne des répétitions) ; les autres sont montées hors du cadre",
        work: "workP50/workP95/workMax : JS par image (rAF) ; upd* : JS par mise à jour de données (message du flux de bout en bout, lots d'étiquettes hors message, paint avec captures)",
        runtimeS: Math.round((Date.now() - started) / 1000),
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Écrit : ${OUT}/aqueduc.csv, ${OUT}/aqueduc-meta.json (${Math.round((Date.now() - started) / 1000)} s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
