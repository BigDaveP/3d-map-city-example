/**
 * Preuves de l'outil de gestion du territoire : captures, vidéo de la visite et résultats, mesurés
 * sur un serveur de production.
 *
 *   npm run build && npx next start -p 3300
 *   BASE_URL=http://localhost:3300 npm run proofs:territoire
 *
 * Sorties de l'outil (docs/territoire/) :
 * - accueil.png : accueil (thème clair) à 14:05, alertes en cours, cinq environnements ;
 * - aqueduc-hic.png : Aqueduc en HTML-in-Canvas à 14:05 (bris non isolé) ;
 * - deneigement-2330-hic.png : Déneigement en HTML-in-Canvas à 23:30, zones A et B en vigueur
 *   (décidées à 08:00 en deux gestes), feux allumés pris dans la phase haute du clignotement ;
 * - deneigement-fiche-zone-a.png : la fiche de la zone A, ouverte d'un clic sur son marquage ;
 * - bascule-1-aqueduc.png, bascule-2-deneigement.png : le même canvas avant et après le passage de
 *   l'Aqueduc au Déneigement par le sélecteur (même objet carte, même canvas, sans rechargement) ;
 * - sans-api.png : Chrome sans l'API (`--disable-blink-features=CanvasDrawElement`), mode classique,
 *   bandeau avec le bouton de la vidéo ;
 * - visite-{accueil,aqueduc,decision,nuit}.png : images extraites de la vidéo de la visite.
 *
 * Vidéo de la visite (10–15 s) : accueil → Aqueduc (bris) → Déneigement (décision, puis 23:30),
 * écrite dans public/territoire/visite-hic.webm (la vidéo proposée par le bandeau sans l'API). Les
 * parties carte sont enregistrées dans la page par `recordMap` (src/client/aqueduc/video.ts, transpilé
 * et injecté tel quel), avec son bandeau de crédits (`VISIT_CREDITS`) ; l'accueil, sans carte, est
 * filmé par Playwright, puis ffmpeg assemble les deux.
 *
 * Toujours dans docs/territoire/ : proofs.json, environnement (navigateur, WebGL, `"gpu"`),
 * `sameMapAcrossEnvs` et détails de chaque preuve.
 *
 * Preuves détaillées de l'environnement Aqueduc (docs/aqueduc/) : occlusion-{classic,hic}.png,
 * sol-hic.png, coupe-hic.png, souterrain-hic.png, focus-hic.png, video-{classic,hic}.webm (export du
 * scénario) et leurs images à 5 s, proofs.json (clic sur une partie masquée, arbre ARIA, focus).
 *
 * `ONLY=territoire` ou `ONLY=aqueduc` limite à l'une des deux séries. Chromium de Playwright, WebGL
 * logiciel (SwiftShader). Demande `ffmpeg` et `ffprobe`. L'horloge commune est épinglée par
 * `window.__territoire.store` sur la journée de référence (`SCENARIO_DAY`) à l'ouverture de chaque
 * page : les captures ne dépendent pas de l'heure du lancement.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import ts from "typescript";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { VISIT_CREDITS } from "../src/lib/territoire/about";
import { atHour } from "../src/lib/territoire/day";

const BASE = process.env.BASE_URL ?? "http://localhost:3300";
const OUT = process.env.OUT ?? "docs/territoire";
const OUT_AQ = process.env.OUT_AQ ?? "docs/aqueduc";
const PUBLIC_VIDEO = process.env.PUBLIC_VIDEO ?? "public/territoire/visite-hic.webm";
const ONLY = process.env.ONLY ?? "";
const VIEW = { width: 1440, height: 860 };
const PROFILE = process.env.PROFILE ?? path.join(os.tmpdir(), "territoire-proofs-profile");
const FLAGS = ["--enable-blink-features=CanvasDrawElement"];

type Mode = "classic" | "hic";
/** Heures épinglées de la journée de référence. */
const AT = {
  /** avant le bris de 14:00 (preuves détaillées de l'aqueduc) */
  noon: atHour(SCENARIO_DAY, "12:00"),
  /** décision du déneigement en deux gestes, avant la décision par défaut de 10:00 */
  morning: atHour(SCENARIO_DAY, "08:00"),
  /** bris non isolé : alerte critique à l'accueil, incident dans l'aqueduc */
  afterBreak: atHour(SCENARIO_DAY, "14:05"),
  /** interdiction en vigueur, feux allumés */
  night: atHour(SCENARIO_DAY, "23:30"),
};

const run = (part: "territoire" | "aqueduc") => !ONLY || ONLY === part;
/** `STEPS=visite,sans-api` (mise au point) : ces preuves de l'outil seulement ; proofs.json n'est pas réécrit. */
const STEPS = process.env.STEPS ? process.env.STEPS.split(",") : null;
const step = (name: string) => !STEPS || STEPS.includes(name);

// ---------------------------------------------------------------------------------------------
// Outils communs

/** Épingle l'horloge commune (×1) par `window.__territoire.store`. */
async function setClock(p: Page, at: number) {
  await p.waitForFunction(() => (window as any).__territoire?.store, null, { timeout: 45_000 });
  await p.evaluate((t) => (window as any).__territoire.store.setState({ clock: { t0: t, speed: 1, startedAt: Date.now() } }), at);
}

/** Horloge épinglée, puis une lecture du flux de l'aqueduc à cette heure. */
async function pinAqueduc(p: Page, at: number) {
  await setClock(p, at);
  await p.waitForFunction((t) => (window as any).__aqueduc.store.getState().live.t >= t, at, { timeout: 15_000 });
}

/** Caméra arrêtée, tuiles chargées, surfaces capturées, puis un temps pour les dernières images. */
async function settle(p: Page, extra = 2500) {
  await p.evaluate(
    () =>
      new Promise<void>((r) => {
        const m = (window as any).__territoire.map;
        if (m.loaded() && !m.isMoving() && m.areTilesLoaded()) return r();
        const t = setTimeout(r, 20_000);
        m.once("idle", () => (clearTimeout(t), r()));
      }),
  );
  await p
    .waitForFunction(() => {
      const L = (window as any).__hicMap?.layer;
      return !L || [...L.panels.values()].every((q: any) => q.tex);
    }, null, { timeout: 20_000 })
    .catch(() => {});
  await p.waitForTimeout(extra);
}

const shot = (p: Page, dir: string, name: string, fullPage = false) => p.screenshot({ path: `${dir}/${name}.png`, fullPage });
const state = (p: Page) =>
  p.evaluate(() => {
    const s = (window as any).__territoire.store.getState();
    return { mode: s.mode, api: s.api, fallback: s.fallback, env: s.env };
  });
/** Zone:état de l'interdiction, dans l'ordre A, B, C (`window.__territoire.snow`). */
const snowPlans = (p: Page) => p.evaluate(() => ((window as any).__territoire.snow.plans() as { zone: string; ban: string }[]).map((x) => `${x.zone}:${x.ban}`).join(" "));

/** Attend le début de la phase haute (opacité 1) du clignotement des feux allumés, puis une image. */
async function highBlink(p: Page) {
  await p
    .waitForFunction(() => {
      const w = window as any;
      const cur = w.__territoire.map.getPaintProperty("dn-lights", "circle-opacity")?.[2];
      const fresh = cur === 1 && w.__proofPhase !== 1;
      w.__proofPhase = cur;
      return fresh;
    }, null, { timeout: 5_000, polling: 30 })
    .catch(() => {});
  await p.waitForTimeout(120);
}

/** Nouvel onglet avec les erreurs de la page relevées. */
async function newPage(ctx: BrowserContext) {
  const p = await ctx.newPage();
  // tsx (esbuild, keepNames) enveloppe les fonctions nommées des callbacks dans __name
  await p.addInitScript("window.__name = (f) => f");
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  return { p, errors };
}

/** Vue 3D en HTML-in-Canvas, API active et marquages capturés. */
async function openHic(ctx: BrowserContext, env: "aqueduc" | "deneigement") {
  const { p, errors } = await newPage(ctx);
  await p.goto(`${BASE}/carte/${env}?mode=hic`);
  if (env === "aqueduc") await p.waitForFunction(() => (window as any).__aqueduc?.store.getState().live.t > 0, null, { timeout: 60_000 });
  else await p.waitForFunction(() => (window as any).__territoire?.snow, null, { timeout: 60_000 });
  await p.waitForFunction(() => (window as any).__territoire.store.getState().api === "active" && (window as any).__hicMap?.layer, null, { timeout: 30_000 });
  return { p, errors };
}

/** Passe à `env` par le sélecteur d'environnement (navigation côté client). */
async function switchTo(p: Page, name: RegExp, env: string) {
  await p.locator(".tr-switcher-btn").click();
  await p.getByRole("dialog", { name: "Changer d'environnement" }).getByRole("button", { name }).click();
  await p.waitForFunction((e) => (window as any).__territoire.env === e, env, { timeout: 15_000 });
}

function environment(webgl: string, browser: string) {
  return {
    date: new Date().toISOString(),
    browser: `Chromium ${browser}`,
    flags: FLAGS,
    webgl,
    gpu: !/SwiftShader|llvmpipe|software/i.test(webgl),
    cpu: `${os.cpus()[0]?.model} × ${os.cpus().length}`,
    viewport: VIEW,
    deviceScaleFactor: 1,
    base: BASE,
  };
}

/** Instants (s) des images d'un fichier vidéo, lus par ffprobe (MediaRecorder n'écrit pas la durée). */
function probe(file: string) {
  const pts = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file])
    .toString()
    .split("\n")
    .map((l) => parseFloat(l))
    .filter(Number.isFinite);
  const [codec, width, height] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", file]).toString().trim().split(",");
  return { codec, width: Number(width), height: Number(height), frames: pts.length, lastFrameS: Math.max(...pts) };
}

// ---------------------------------------------------------------------------------------------
// Outil de gestion du territoire (docs/territoire)

/** Accueil, thème clair, à 14:05 : alertes en tête, cinq environnements. */
async function home(b: Browser) {
  const ctx = await b.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: "light" });
  const { p, errors } = await newPage(ctx);
  await p.goto(`${BASE}/`);
  await setClock(p, AT.afterBreak);
  await p.locator(".tr-alert", { hasText: "Bris de conduite" }).waitFor({ timeout: 10_000 });
  await p.waitForTimeout(800);
  await shot(p, OUT, "accueil", true);
  const r = {
    file: `${OUT}/accueil.png`,
    stamp: await p.locator(".tr-home-stamp").innerText(),
    alerts: await p.locator(".tr-alert").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-sev")} · ${(e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90)}`)),
    envs: await p.locator(".tr-envcard").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-env")}${e.querySelector("a") ? "" : " (à venir)"}`)),
    errors,
  };
  await ctx.close();
  return r;
}

/** Aqueduc en HTML-in-Canvas à 14:05, caméra de départ. */
async function aqueducHic(ctx: BrowserContext) {
  const { p, errors } = await openHic(ctx, "aqueduc");
  await pinAqueduc(p, AT.afterBreak);
  await settle(p, 3000);
  await shot(p, OUT, "aqueduc-hic");
  const r = {
    file: `${OUT}/aqueduc-hic.png`,
    state: await state(p),
    surfaces: await p.evaluate(() => [...(window as any).__hicMap.layer.panels.keys()]),
    incident: await p.evaluate(() => !!(window as any).__aqueduc.store.getState().incident),
    errors,
  };
  await p.close();
  return r;
}

/**
 * Déneigement en HTML-in-Canvas : décision A + B à 08:00 (deux zones cochées, un bouton), puis 23:30
 * (A et B en vigueur, feux allumés) ; ensuite la fiche de la zone A, d'un clic sur son marquage.
 */
async function deneigementHic(ctx: BrowserContext) {
  const { p, errors } = await openHic(ctx, "deneigement");
  await setClock(p, AT.morning);
  await p.waitForTimeout(600);
  const box = (z: string) => p.locator(".dn-zone-opt", { hasText: `Zone ${z}` }).locator("input");
  await box("A").check();
  await box("B").check();
  await p.getByRole("button", { name: "Décider pour ce soir" }).click();
  await p.waitForTimeout(300);
  const at0800 = await snowPlans(p);
  await setClock(p, AT.night);
  await p.waitForFunction(() => {
    const w = window as any;
    const L = w.__hicMap.layer;
    return ["zone:A", "zone:B", "zone:C"].every((k) => L.panels.get(k)?.tex) && w.__territoire.snow.plans()[0].ban === "en-vigueur";
  }, null, { timeout: 20_000 });
  await settle(p, 2500);
  await highBlink(p);
  await shot(p, OUT, "deneigement-2330-hic");
  const night = {
    file: `${OUT}/deneigement-2330-hic.png`,
    state: await state(p),
    plans0800: at0800,
    plans2330: await snowPlans(p),
    decided: await p.locator(".dn-decided").innerText(),
    marks: await p.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.maplibregl-canvas > [data-panel^="zone:"]')].map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()),
    ),
    lightsOpacity: await p.evaluate(() => (window as any).__territoire.map.getPaintProperty("dn-lights", "circle-opacity")),
  };

  // fiche de la zone A : clic sur son marquage, dans la scène
  const pt = await p.evaluate(() => {
    const q = (window as any).__hicMap.layer.panels.get("zone:A");
    const r = (window as any).__territoire.map.getCanvas().getBoundingClientRect();
    if (!q?.proj) return null;
    const [x, y] = q.proj.project(q.w / 2, q.h * 0.3);
    return { x: r.left + x, y: r.top + y };
  });
  if (!pt) throw new Error("marquage de la zone A absent de la scène");
  await p.mouse.move(pt.x, pt.y);
  await p.waitForTimeout(800);
  await p.mouse.click(pt.x, pt.y);
  const card = await p.locator("[data-testid=inspector]").innerText({ timeout: 5_000 });
  await settle(p, 1500);
  await highBlink(p);
  await shot(p, OUT, "deneigement-fiche-zone-a");
  const inspector = { file: `${OUT}/deneigement-fiche-zone-a.png`, click: pt, inspector: card.split("\n").filter(Boolean).slice(0, 12), errors };
  await p.close();
  return { night, inspector };
}

/** Passage de l'Aqueduc au Déneigement par le sélecteur : même carte, même canvas, sans rechargement. */
async function envSwitch(ctx: BrowserContext) {
  const { p, errors } = await openHic(ctx, "aqueduc");
  await pinAqueduc(p, AT.afterBreak);
  await settle(p, 2500);
  const before = await p.evaluate(() => {
    const w = window as any;
    w.__proofMap = w.__territoire.map;
    w.__proofCanvas = w.__territoire.map.getCanvas();
    w.__proofNoReload = true;
    return { env: w.__territoire.env, id: w.__territoire.map.__id, url: location.pathname, surfaces: [...w.__hicMap.layer.panels.keys()].length };
  });
  await shot(p, OUT, "bascule-1-aqueduc");
  await switchTo(p, /Déneigement/, "deneigement");
  await p.waitForFunction(() => {
    const L = (window as any).__hicMap?.layer;
    return L && ["zone:A", "zone:B", "zone:C"].every((k) => L.panels.get(k)?.tex);
  }, null, { timeout: 20_000 });
  await settle(p, 2500);
  await shot(p, OUT, "bascule-2-deneigement");
  const after = await p.evaluate(() => {
    const w = window as any;
    return {
      env: w.__territoire.env,
      id: w.__territoire.map.__id,
      url: location.pathname,
      sameMap: w.__territoire.map === w.__proofMap,
      sameCanvas: w.__territoire.map.getCanvas() === w.__proofCanvas,
      canvases: document.querySelectorAll("canvas.maplibregl-canvas").length,
      noReload: w.__proofNoReload === true,
      surfaces: [...w.__hicMap.layer.panels.keys()],
    };
  });
  await p.close();
  return {
    files: [`${OUT}/bascule-1-aqueduc.png`, `${OUT}/bascule-2-deneigement.png`],
    before,
    after,
    sameMap: after.sameMap && after.sameCanvas && after.noReload && after.id === before.id && after.canvases === 1,
    errors,
  };
}

/** Chrome sans l'API : mode classique, bandeau et bouton de la vidéo (le fichier existe). */
async function withoutApi() {
  const nb = await chromium.launch({ args: ["--disable-blink-features=CanvasDrawElement"] });
  const p = await nb.newPage({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: "light" });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/carte/deneigement?mode=hic`);
  await p.waitForFunction(() => (window as any).__territoire?.snow, null, { timeout: 60_000 });
  await setClock(p, AT.night);
  await p.locator("[data-testid=noapi]").waitFor({ timeout: 8_000 });
  await p.getByRole("button", { name: "Voir la version HTML-in-Canvas en vidéo" }).waitFor({ timeout: 8_000 }).catch(() => {});
  await settle(p, 2500);
  await shot(p, OUT, "sans-api");
  const r = {
    file: `${OUT}/sans-api.png`,
    state: await state(p),
    hicLayer: await p.evaluate(() => (window as any).__hicMap?.layer ?? null),
    bandeau: await p.locator("[data-testid=noapi]").innerText(),
    boutonVideo: await p.getByRole("button", { name: "Voir la version HTML-in-Canvas en vidéo" }).count(),
    errors,
  };
  await nb.close();
  return r;
}

/** `recordMap` et le bandeau de crédits de l'application, transpilés pour la page (aucun import à l'exécution). */
function recorderScript() {
  const src = readFileSync("src/client/aqueduc/video.ts", "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `(() => { const exports = {}; ${js}\nwindow.__video = exports; })();`;
}

/**
 * Vidéo de la visite : partie carte d'abord (Aqueduc à 14:05, le bris ; sélecteur → Déneigement ;
 * décision A + B, la zone C retirée de la décision par défaut ; 23:30, A et B en vigueur), enregistrée
 * dans la page par `recordMap` avec le bandeau des crédits ; puis l'accueil filmé par Playwright à la
 * taille de la carte, posé sur le même bandeau, et les deux assemblés par ffmpeg.
 */
async function visit(b: Browser, ctx: BrowserContext) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "territoire-visite-"));
  /** enregistrement de la carte, coupé ensuite 2,2 s après le passage à 23:30 */
  const MAP_MAX_MS = 14_000;
  const HOME_S = 2.5;
  const marks: Record<string, number> = {};

  // 1. carte : un seul enregistrement, la carte survit au changement d'environnement
  const { p, errors } = await openHic(ctx, "aqueduc");
  await pinAqueduc(p, AT.afterBreak);
  await settle(p, 2500);
  await p.addScriptTag({ content: recorderScript() });
  await p.evaluate(
    ([credits, ms]) => {
      const w = window as any;
      w.__visitT0 = performance.now();
      w.__visit = w.__video.recordMap(w.__territoire.map, credits, ms).then(
        (r: { url: string; size: number; ms: number }) =>
          fetch(r.url)
            .then((x) => x.blob())
            .then(
              (blob) =>
                new Promise((ok) => {
                  const fr = new FileReader();
                  fr.onload = () => ok({ size: r.size, ms: r.ms, data: String(fr.result).split(",")[1] });
                  fr.readAsDataURL(blob);
                }),
            ),
      );
      // lent tour autour du centre-ville pendant le bris
      const m = w.__territoire.map;
      m.easeTo({ bearing: m.getBearing() + 18, duration: 2400, easing: (t: number) => t });
    },
    [[...VISIT_CREDITS], MAP_MAX_MS] as const,
  );
  /** secondes écoulées depuis le début de l'enregistrement (horloge de la page) */
  const now = () => p.evaluate(() => (performance.now() - (window as any).__visitT0) / 1000);
  await p.waitForTimeout(2400);
  marks.selecteur = await now();
  // pendant l'enregistrement, la page est saturée (un rendu par image) : clics directs, sans les
  // attentes de stabilité de Playwright, sur les mêmes contrôles qu'un visiteur
  await p.evaluate(() => document.querySelector<HTMLButtonElement>(".tr-switcher-btn")!.click());
  const env = p.getByRole("dialog", { name: "Changer d'environnement" }).getByRole("button", { name: /Déneigement/ });
  await env.waitFor({ timeout: 5_000 });
  await env.dispatchEvent("click");
  await p.waitForFunction(() => {
    const w = window as any;
    const L = w.__hicMap?.layer;
    return w.__territoire.snow && L && ["zone:A", "zone:B", "zone:C"].every((k) => L.panels.get(k)?.tex);
  }, null, { timeout: 15_000 });
  marks.arrivee = await now();
  const plansDefault = await snowPlans(p);
  // l'état par défaut (A, B, C programmées) reste un instant à l'écran
  await p.waitForTimeout(1200);
  // décision : la zone C retirée de la décision par défaut (A, B, C) ; ses feux s'éteignent
  await p.locator(".dn-zone-opt", { hasText: "Zone C" }).locator("input").dispatchEvent("click");
  await p.getByRole("button", { name: "Décider pour ce soir" }).dispatchEvent("click");
  marks.decision = await now();
  const plansDecided = await snowPlans(p);
  // le marquage de C est recapturé (au plus une capture par élément toutes les 2 s)
  await p.waitForTimeout(2000);
  await setClock(p, AT.night);
  marks.nuit = await now();
  const end = Math.min(marks.nuit + 2.2, MAP_MAX_MS / 1000);
  const rec = (await p.evaluate(() => (window as any).__visit)) as { size: number; ms: number; data: string };
  const plansNight = await snowPlans(p);
  const box = await p.evaluate(() => {
    const c = (window as any).__territoire.map.getCanvas() as HTMLCanvasElement;
    return { w: c.width - (c.width % 2), h: c.height - (c.height % 2) };
  });
  await p.close();
  const mapFile = path.join(tmp, "carte.webm");
  writeFileSync(mapFile, Buffer.from(rec.data, "base64"));
  const mapProbe = probe(mapFile);
  const strip = mapProbe.height - box.h;

  // 2. accueil, à la taille de l'image de la carte, filmé par Playwright (alertes en haut de page)
  const hctx = await b.newContext({ viewport: { width: box.w, height: box.h }, deviceScaleFactor: 1, colorScheme: "light", recordVideo: { dir: tmp, size: { width: box.w, height: box.h } } });
  const hp = await hctx.newPage();
  const born = Date.now();
  await hp.goto(`${BASE}/`);
  await setClock(hp, AT.afterBreak);
  const bris = hp.locator(".tr-alert", { hasText: "Bris de conduite" });
  await bris.waitFor({ timeout: 10_000 });
  await hp.waitForTimeout(400);
  const ready = (Date.now() - born) / 1000;
  await hp.waitForTimeout(1000);
  await bris.getByRole("link", { name: /Ouvrir/ }).hover();
  await hp.waitForTimeout(HOME_S * 1000);
  const homeRaw = (await hp.video()!.path())!;
  await hctx.close();

  // 3. assemblage : accueil + bandeau (découpé dans la première image de la carte), puis la carte
  const stripPng = path.join(tmp, "bandeau.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mapFile, "-vf", `crop=${box.w}:${strip}:0:${box.h}`, "-frames:v", "1", stripPng]);
  const out = PUBLIC_VIDEO;
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-ss", ready.toFixed(2), "-t", String(HOME_S), "-i", homeRaw,
    "-loop", "1", "-t", String(HOME_S), "-i", stripPng,
    "-t", end.toFixed(2), "-i", mapFile,
    "-filter_complex",
    [
      `[0:v]scale=${box.w}:${box.h},setsar=1,fps=25,setpts=PTS-STARTPTS[h]`,
      `[1:v]fps=25,setsar=1[s]`,
      `[h][s]vstack=inputs=2,format=yuv420p[home]`,
      `[2:v]fps=25,setsar=1,setpts=PTS-STARTPTS,format=yuv420p[map]`,
      `[home][map]concat=n=2:v=1:a=0[v]`,
    ].join(";"),
    "-map", "[v]", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-an", out,
  ]);
  const visitProbe = probe(out);
  // images de contrôle : accueil, bris, décision prise (juste avant 23:30), 23:30
  const frames: Record<string, number> = {
    accueil: 1.2,
    aqueduc: HOME_S + 1.5,
    decision: HOME_S + marks.nuit - 0.2,
    nuit: HOME_S + end - 0.3,
  };
  const images: Record<string, string> = {};
  for (const [name, t] of Object.entries(frames)) {
    const f = `${OUT}/visite-${name}.png`;
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", out, "-frames:v", "1", f]);
    images[name] = `${f} (${t.toFixed(1)} s)`;
  }
  rmSync(tmp, { recursive: true, force: true });
  const r2 = (x: number) => Number(x.toFixed(2));
  return {
    file: out,
    octets: statSync(out).size,
    ffprobe: visitProbe,
    durationS: r2(visitProbe.lastFrameS + 1 / 25),
    parts: { accueilS: HOME_S, carteS: r2(end), carteImagesEnregistrees: mapProbe.frames, carteImagesParS: Number((mapProbe.frames / mapProbe.lastFrameS).toFixed(1)), carte: `${box.w}×${box.h}`, bandeau: strip },
    marksS: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, r2(HOME_S + v)])),
    credits: VISIT_CREDITS,
    plans: { aLArrivee: plansDefault, apresDecision: plansDecided, a2330: plansNight },
    recordMap: { octets: rec.size, ms: Math.round(rec.ms) },
    images,
    errors,
  };
}

async function territoire(b: Browser, ctx: BrowserContext, results: Record<string, unknown>) {
  mkdirSync(OUT, { recursive: true });
  if (step("accueil")) results.accueil = await home(b);
  if (step("aqueduc")) results.aqueduc_hic = await aqueducHic(ctx);
  if (step("deneigement")) {
    const dn = await deneigementHic(ctx);
    results.deneigement_2330_hic = dn.night;
    results.fiche_zone_a = dn.inspector;
  }
  if (step("bascule")) {
    const sw = await envSwitch(ctx);
    results.bascule = sw;
    results.sameMapAcrossEnvs = sw.sameMap;
  }
  if (step("visite")) results.visite = await visit(b, ctx);
  // après la vidéo : le bandeau propose le fichier publié
  if (step("sans-api")) results.sans_api = await withoutApi();
}

// ---------------------------------------------------------------------------------------------
// Preuves détaillées de l'environnement Aqueduc (docs/aqueduc)

/**
 * Centre-ville vu du nord-nord-est, bas sur l'horizon : des bâtiments passent devant son marquage au
 * sol et une tour coupe l'étiquette du capteur P-01 (vérifié à l'œil, 1440 × 860).
 */
const CAM_OCCLUSION = { center: [-72.543, 46.344], zoom: 17.3, pitch: 70, bearing: 200 };
/** Vue large inclinée : marquages de secteurs posés au sol, en perspective. */
const CAM_GROUND = { center: [-72.548, 46.348], zoom: 15.0, pitch: 60, bearing: -25 };

async function openAq(ctx: BrowserContext, mode: Mode, cam?: object) {
  const { p, errors } = await newPage(ctx);
  await p.goto(`${BASE}/carte/aqueduc?mode=${mode}`);
  await p.waitForFunction(() => (window as any).__aqueduc?.store.getState().live.t > 0, null, { timeout: 60_000 });
  await pinAqueduc(p, AT.noon);
  if (mode === "hic") await p.waitForFunction(() => (window as any).__hicMap?.layer, null, { timeout: 20_000 });
  if (cam) await p.evaluate((c) => (window as any).__aqueduc.map.jumpTo(c), cam as never);
  await settle(p);
  return { p, errors };
}

/** Points d'un glyphe opaque du marquage du Centre-ville, masqué / dégagé par les bâtiments (méthode du smoke). */
async function glyphPoints(p: Page) {
  return p.evaluate(() => {
    const { map } = (window as any).__aqueduc;
    const L = (window as any).__hicMap.layer;
    const q = L.panels.get("sector:centre-ville");
    const canvas = map.getCanvas() as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    if (!q?.proj || !q.tex) return null;
    const gl = map.painter.context.gl as WebGL2RenderingContext;
    const scale = canvas.width / canvas.clientWidth;
    const tw = Math.ceil(q.w * scale);
    const th = Math.ceil(q.h * scale);
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, q.tex, 0);
    const px = new Uint8Array(tw * th * 4);
    gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    gl.deleteFramebuffer(fb);
    let hidden: { x: number; y: number } | null = null;
    let open: { x: number; y: number } | null = null;
    for (let v = 3; v < q.h - 3; v += 2)
      for (let u = 3; u < q.w - 3; u += 2) {
        let full = true;
        for (let dv = -2; dv <= 2 && full; dv++)
          for (let du = -2; du <= 2 && full; du++) full = px[(Math.round((v + dv) * scale) * tw + Math.round((u + du) * scale)) * 4 + 3] >= 200;
        if (!full) continue;
        const [x, y] = q.proj.project(u, v);
        if (x < 20 || x > box.width - 20 || y < 40 || y > box.height - 150) continue;
        const others = [...L.panels.values()].some((o: any) => {
          if (o === q || !o.proj) return false;
          const uv = o.proj.unproject(x, y);
          return uv && uv[0] >= -6 && uv[1] >= -6 && uv[0] <= o.w + 6 && uv[1] <= o.h + 6;
        });
        if (others) continue;
        const hits = [[0, 0], [-6, 0], [6, 0], [0, -6], [0, 6], [-10, -10], [10, 10], [-10, 10], [10, -10]].map((d) => map.queryRenderedFeatures([x + d[0], y + d[1]], { layers: ["building-3d"] }).length > 0);
        if (!hidden && hits.slice(0, 5).every(Boolean)) hidden = { x: box.left + x, y: box.top + y };
        if (!open && !hits.some(Boolean)) open = { x: box.left + x, y: box.top + y };
      }
    return { hidden, open };
  });
}

async function clickAt(p: Page, pt: { x: number; y: number }) {
  const before = await p.evaluate(() => ({ passThrough: 0, queries: 0, ...(window as any).__occlusion }));
  await p.mouse.move(pt.x, pt.y);
  await p.waitForTimeout(900);
  const top = await p.evaluate(({ x, y }) => {
    const e = document.elementFromPoint(x, y);
    return e ? `${e.tagName.toLowerCase()}${(e as HTMLElement).closest?.("[data-panel]") ? `@${(e as HTMLElement).closest("[data-panel]")!.getAttribute("data-panel")}` : ""}` : null;
  }, pt);
  await p.mouse.click(pt.x, pt.y);
  await p.waitForTimeout(400);
  const r = await p.evaluate((b) => {
    const w = window as any;
    return { passThrough: (w.__occlusion?.passThrough ?? 0) - b.passThrough, queries: (w.__occlusion?.queries ?? 0) - b.queries, selection: w.__aqueduc.store.getState().selection };
  }, before);
  await p.keyboard.press("Escape");
  await p.evaluate(() => (window as any).__aqueduc.store.setState({ selection: null }));
  return { point: pt, elementFromPoint: top, ...r };
}

/** Tab depuis le haut de la page jusqu'à une étiquette de capteur ; Entrée ouvre sa fiche. */
async function keyboardFocus(p: Page, mode: Mode) {
  // départ du haut du document, sans clic (un clic sur la carte sélectionnerait une conduite)
  await p.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    (window as any).__aqueduc.store.setState({ selection: null });
  });
  for (let i = 1; i <= 80; i++) {
    await p.keyboard.press("Tab");
    const f = await p.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a?.dataset.sensor ? { sensor: a.dataset.sensor, inCanvas: !!a.closest("canvas"), label: a.getAttribute("aria-label") } : null;
    });
    if (f) {
      await p.waitForTimeout(1200);
      if (mode === "hic") await shot(p, OUT_AQ, "focus-hic");
      await p.keyboard.press("Enter");
      const insp = await p.locator("[data-testid=inspector]").innerText({ timeout: 5_000 }).catch(() => "");
      await p.keyboard.press("Escape");
      return { tabs: i, ...f, enterOpensInspector: insp.includes(f.sensor), inspector: insp.split("\n").slice(0, 3).join(" · ") };
    }
  }
  return { tabs: null };
}

/** Export vidéo du scénario de bris (bouton « Exporter la vidéo » du récit) et image à 5 s. */
async function exportVideo(ctx: BrowserContext, mode: Mode) {
  const { p, errors } = await openAq(ctx, mode);
  await p.evaluate(() => (window as any).__aqueduc.play("rapport"));
  await p.waitForTimeout(2500);
  await settle(p, 1500);
  const t = Date.now();
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60_000 }), p.getByRole("button", { name: "Exporter la vidéo" }).click()]);
  const file = `${OUT_AQ}/video-${mode}.webm`;
  await dl.saveAs(file);
  await p.waitForFunction(() => /Vidéo enregistrée/.test(document.querySelector(".aq-story-export .aq-note")?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => {});
  const msg = await p.locator(".aq-story-export .aq-note").innerText().catch(() => "");
  const r: Record<string, unknown> = { file, octets: statSync(file).size, message: msg, wallMs: Date.now() - t, errors };
  const v = probe(file);
  r.ffprobe = { stream: `${v.codec},${v.width},${v.height}`, frames: v.frames, lastFrameS: v.lastFrameS };
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "5", "-i", file, "-frames:v", "1", `${OUT_AQ}/video-${mode}-image-5s.png`]);
  r.image5s = `${OUT_AQ}/video-${mode}-image-5s.png`;
  await p.close();
  return r;
}

async function aqueduc(ctx: BrowserContext, results: Record<string, unknown>) {
  mkdirSync(OUT_AQ, { recursive: true });
  const stateAq = (p: Page) =>
    p.evaluate(() => {
      const s = (window as any).__aqueduc.territoire.getState();
      return { mode: s.mode, api: s.api, fallback: s.fallback };
    });

  // 1. occlusion : même caméra ; en HTML-in-Canvas les bâtiments masquent le marquage au sol et les
  // étiquettes, en classique les étiquettes DOM restent au premier plan
  for (const mode of ["classic", "hic"] as const) {
    const { p, errors } = await openAq(ctx, mode, CAM_OCCLUSION);
    await shot(p, OUT_AQ, `occlusion-${mode}`);
    const r: Record<string, unknown> = { state: await stateAq(p), camera: CAM_OCCLUSION };
    if (mode === "hic") {
      // 2. clic sur la partie masquée d'un marquage : traverse vers la carte ; témoin dégagé : sélectionne
      const g = await glyphPoints(p);
      r.glyphes = g;
      if (g?.hidden) r.clicMasque = await clickAt(p, g.hidden);
      if (g?.open) r.clicDegage = await clickAt(p, g.open);
    } else {
      // l'étiquette DOM du Centre-ville reçoit le clic même là où un bâtiment se dresse devant le lieu
      const pt = await p.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>(".aq-flat-sector")].find((e) => /centre-ville/i.test(e.textContent ?? ""));
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const { map } = (window as any).__aqueduc;
        const box = map.getCanvas().getBoundingClientRect();
        const x = b.left + b.width / 2;
        const y = b.top + b.height / 2;
        return { x, y, building: map.queryRenderedFeatures([x - box.left, y - box.top], { layers: ["building-3d"] }).length > 0 };
      });
      r.etiquetteCentreVille = pt;
      if (pt) r.clic = await clickAt(p, pt);
    }
    r.errors = errors;
    results[`occlusion_${mode}`] = r;
    await p.close();
  }

  // 3. marquages au sol, en perspective
  {
    const { p } = await openAq(ctx, "hic", CAM_GROUND);
    await shot(p, OUT_AQ, "sol-hic");
    results.sol_hic = { state: await stateAq(p), surfaces: await p.evaluate(() => [...(window as any).__hicMap.layer.panels.keys()]) };
    await p.close();
  }

  // 4. coupe sous la rue (étape d'isolation), vannes ouvertes
  {
    const { p, errors } = await openAq(ctx, "hic");
    await p.evaluate(() => (window as any).__aqueduc.play("isolation"));
    await p.waitForTimeout(2200);
    await p.waitForFunction(() => (window as any).__hicMap.layer.panels.get("cut:13C1949")?.tex, null, { timeout: 20_000 }).catch(() => {});
    await settle(p, 3000);
    await shot(p, OUT_AQ, "coupe-hic");
    results.coupe_hic = {
      state: await stateAq(p),
      cut: await p.evaluate(() => !!(window as any).__hicMap.layer.panels.get("cut:13C1949")?.tex),
      valves: await p.evaluate(() => [...document.querySelectorAll('[data-panel="cut:13C1949"] button.aq-valve')].map((e) => e.textContent)),
      errors,
    };
    await p.close();
  }

  // 5. vue souterraine sur le tronçon du scénario
  {
    const { p, errors } = await openAq(ctx, "hic");
    await p.evaluate(() => {
      const { map, net, store } = (window as any).__aqueduc;
      const c = net.data.segments.features[net.segById.get("13C1949")].geometry.coordinates;
      map.jumpTo({ center: c[Math.floor(c.length / 2)], zoom: 17.2, pitch: 62, bearing: -25 });
      store.setState({ underground: true });
    });
    await p.waitForFunction(() => (window as any).__aqueduc.tubes?.stats.instances > 0, null, { timeout: 20_000 }).catch(() => {});
    await settle(p, 3000);
    await shot(p, OUT_AQ, "souterrain-hic");
    results.souterrain_hic = { state: await stateAq(p), instances: await p.evaluate(() => (window as any).__aqueduc.tubes.stats.instances), errors };
    await p.close();
  }

  // 6. arbre d'accessibilité et focus au clavier, dans les deux modes (vue d'ouverture)
  for (const mode of ["classic", "hic"] as const) {
    const { p } = await openAq(ctx, mode);
    const aria = await p.locator("body").ariaSnapshot();
    // capteurs et secteurs listés à part : une coupe commune laissait tomber les secteurs
    const lines = aria.split("\n").map((l) => l.trim()).filter((l) => /^- '?button/.test(l));
    results[`aria_${mode}`] = {
      capteurs: lines.filter((l) => /(pression|débit|réservoir|point de mesure).*\(simulation\)/i.test(l)).slice(0, 8),
      secteurs: lines.filter((l) => /Secteur .*\(simulé\)/.test(l)),
    };
    results[`focus_${mode}`] = await keyboardFocus(p, mode);
    await p.close();
  }

  // 7. export vidéo de la séquence (10 s) et image à 5 s : marquages dans le cadre en HTML-in-Canvas seulement
  for (const mode of ["classic", "hic"] as const) results[`video_${mode}`] = await exportVideo(ctx, mode);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { args: FLAGS, viewport: VIEW, deviceScaleFactor: 1, acceptDownloads: true, colorScheme: "light" });
  // contextes neufs (accueil, vidéo de l'accueil) : un navigateur à part, mêmes drapeaux
  const b = await chromium.launch({ args: FLAGS });
  const p = await ctx.newPage();
  const webgl = String(await p.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2"); const e = gl && gl.getExtension("WEBGL_debug_renderer_info"); return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "aucun WebGL2"; })()`));
  const env = environment(webgl, b.version());
  await p.close();
  const written: string[] = [];
  try {
    if (run("territoire")) {
      const results: Record<string, unknown> = { environment: env };
      await territoire(b, ctx, results);
      if (!STEPS) writeFileSync(`${OUT}/proofs.json`, JSON.stringify(results, null, 2) + "\n"), written.push(`${OUT}/proofs.json`);
      console.log(JSON.stringify(results, null, 2));
    }
    if (run("aqueduc") && !STEPS) {
      const results: Record<string, unknown> = { environment: env };
      await aqueduc(ctx, results);
      writeFileSync(`${OUT_AQ}/proofs.json`, JSON.stringify(results, null, 2) + "\n");
      written.push(`${OUT_AQ}/proofs.json`);
      console.log(JSON.stringify(results, null, 2));
    }
  } finally {
    await ctx.close();
    await b.close();
  }
  console.log(written.length ? `Écrit : ${written.join(", ")}` : "proofs.json non réécrit (STEPS)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
