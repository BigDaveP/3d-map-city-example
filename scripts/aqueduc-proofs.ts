/**
 * Preuves de la démo réseau d'eau (`/`) : captures d'écran, vidéos et résultats de tests, mêmes
 * scènes dans les deux modes.
 *
 *   npm run build && npx next start -p 3300
 *   BASE_URL=http://localhost:3300 npm run proofs:aqueduc
 *
 * Sorties (docs/aqueduc/) : occlusion-{classic,hic}.png, sol-hic.png, coupe-hic.png,
 * souterrain-hic.png, sans-api.png, video-{classic,hic}.webm et video-{classic,hic}-image-5s.png,
 * proofs.json (clic sur une partie masquée, arbre ARIA, focus au clavier, vidéos). Copie ensuite
 * video-hic.webm vers public/aqueduc/scenario-hic.webm (proposée par le bandeau sans l'API).
 * Ici Chromium de Playwright, WebGL logiciel ; images extraites avec ffmpeg s'il est installé.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3300";
const OUT = process.env.OUT ?? "docs/aqueduc";
const PUBLIC_VIDEO = process.env.PUBLIC_VIDEO ?? "public/aqueduc/scenario-hic.webm";
const VIEW = { width: 1440, height: 860 };
const PROFILE = process.env.PROFILE ?? path.join(os.tmpdir(), "aqueduc-proofs-profile");
mkdirSync(OUT, { recursive: true });
const results: Record<string, unknown> = {};

type Mode = "classic" | "hic";
/** Centre-ville vu du sud-est, bas sur l'horizon : des bâtiments passent devant son marquage au sol. */
const CAM_OCCLUSION = { center: [-72.5427, 46.3437], zoom: 17.1, pitch: 68, bearing: -40 };
/** Vue large inclinée : marquages de secteurs posés au sol, en perspective. */
const CAM_GROUND = { center: [-72.548, 46.348], zoom: 15.0, pitch: 60, bearing: -25 };

async function open(ctx: BrowserContext, mode: Mode, cam?: object) {
  const p = await ctx.newPage();
  await p.addInitScript("window.__name = (f) => f");
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/?mode=${mode}`);
  await p.waitForFunction(() => (window as any).__aqueduc?.store.getState().live.t > 0, null, { timeout: 60_000 });
  if (mode === "hic") await p.waitForFunction(() => (window as any).__hicMap?.layer, null, { timeout: 20_000 });
  if (cam) await p.evaluate((c) => (window as any).__aqueduc.map.jumpTo(c), cam as never);
  await settle(p);
  return { p, errors };
}

/** Caméra arrêtée, tuiles chargées, surfaces capturées, puis un temps pour les dernières images. */
async function settle(p: Page, extra = 2500) {
  await p.evaluate(
    () =>
      new Promise<void>((r) => {
        const m = (window as any).__aqueduc.map;
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

const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.png` });
const state = (p: Page) =>
  p.evaluate(() => {
    const s = (window as any).__aqueduc.store.getState();
    return { mode: s.mode, api: s.api, fallback: s.fallback };
  });

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
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await p.mouse.click(VIEW.width - 5, 70).catch(() => {});
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 1; i <= 80; i++) {
    await p.keyboard.press("Tab");
    const f = await p.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a?.dataset.sensor ? { sensor: a.dataset.sensor, inCanvas: !!a.closest("canvas"), label: a.getAttribute("aria-label") } : null;
    });
    if (f) {
      await p.waitForTimeout(1200);
      if (mode === "hic") await shot(p, "focus-hic");
      await p.keyboard.press("Enter");
      const insp = await p.locator("[data-testid=inspector]").innerText({ timeout: 5_000 }).catch(() => "");
      await p.keyboard.press("Escape");
      return { tabs: i, ...f, enterOpensInspector: insp.includes(f.sensor), inspector: insp.split("\n").slice(0, 3).join(" · ") };
    }
  }
  return { tabs: null };
}

async function exportVideo(ctx: BrowserContext, mode: Mode) {
  const { p, errors } = await open(ctx, mode);
  await p.evaluate(() => (window as any).__aqueduc.play("rapport"));
  await p.waitForTimeout(2500);
  await settle(p, 1500);
  const t = Date.now();
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60_000 }), p.getByRole("button", { name: "Exporter la vidéo" }).click()]);
  const file = `${OUT}/video-${mode}.webm`;
  await dl.saveAs(file);
  await p.waitForFunction(() => /Vidéo enregistrée/.test(document.querySelector(".aq-story-export .aq-note")?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => {});
  const msg = await p.locator(".aq-story-export .aq-note").innerText().catch(() => "");
  const r: Record<string, unknown> = { file, octets: statSync(file).size, message: msg, wallMs: Date.now() - t, errors };
  try {
    // durée lue dans le fichier (MediaRecorder n'écrit pas toujours la durée dans l'en-tête : -count_packets)
    const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=width,height,nb_read_packets:format=duration", "-of", "json", file]).toString();
    r.ffprobe = JSON.parse(probe);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "5", "-i", file, "-frames:v", "1", `${OUT}/video-${mode}-image-5s.png`]);
    r.image5s = `${OUT}/video-${mode}-image-5s.png`;
  } catch (e) {
    r.ffmpeg = `indisponible : ${(e as Error).message.split("\n")[0]}`;
  }
  await p.close();
  return r;
}

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { args: ["--enable-blink-features=CanvasDrawElement"], viewport: VIEW, deviceScaleFactor: 1, acceptDownloads: true });

  // 1. occlusion : même caméra ; en HTML-in-Canvas les bâtiments masquent le marquage au sol et les
  // étiquettes, en classique les étiquettes DOM restent au premier plan
  for (const mode of ["classic", "hic"] as const) {
    const { p, errors } = await open(ctx, mode, CAM_OCCLUSION);
    await shot(p, `occlusion-${mode}`);
    const r: Record<string, unknown> = { state: await state(p), camera: CAM_OCCLUSION };
    if (mode === "hic") {
      // 2. clic sur la partie masquée d'un marquage : traverse vers la carte ; témoin dégagé : sélectionne
      const g = await glyphPoints(p);
      r.glyphes = g;
      if (g?.hidden) r.clicMasque = await clickAt(p, g.hidden);
      if (g?.open) r.clicDegage = await clickAt(p, g.open);
    } else {
      // l'étiquette DOM du Centre-ville reçoit le clic même là où un bâtiment se dresse devant le lieu
      const pt = await p.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>(".aq-flat-sector")].find((e) => /Centre-ville/.test(e.textContent ?? ""));
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
    const { p } = await open(ctx, "hic", CAM_GROUND);
    await shot(p, "sol-hic");
    results.sol_hic = { state: await state(p), surfaces: await p.evaluate(() => [...(window as any).__hicMap.layer.panels.keys()]) };
    await p.close();
  }

  // 4. coupe sous la rue (étape d'isolation), vannes ouvertes
  {
    const { p, errors } = await open(ctx, "hic");
    await p.evaluate(() => (window as any).__aqueduc.play("isolation"));
    await p.waitForTimeout(2200);
    await p.waitForFunction(() => (window as any).__hicMap.layer.panels.get("cut:13C1949")?.tex, null, { timeout: 20_000 }).catch(() => {});
    await settle(p, 3000);
    await shot(p, "coupe-hic");
    results.coupe_hic = {
      state: await state(p),
      cut: await p.evaluate(() => !!(window as any).__hicMap.layer.panels.get("cut:13C1949")?.tex),
      valves: await p.evaluate(() => [...document.querySelectorAll('[data-panel="cut:13C1949"] button.aq-valve')].map((e) => e.textContent)),
      errors,
    };
    await p.close();
  }

  // 5. vue souterraine sur le tronçon du scénario
  {
    const { p, errors } = await open(ctx, "hic");
    await p.evaluate(() => {
      const { map, net, store } = (window as any).__aqueduc;
      const c = net.data.segments.features[net.segById.get("13C1949")].geometry.coordinates;
      map.jumpTo({ center: c[Math.floor(c.length / 2)], zoom: 17.2, pitch: 62, bearing: -25 });
      store.setState({ underground: true });
    });
    await p.waitForFunction(() => (window as any).__aqueduc.tubes?.stats.instances > 0, null, { timeout: 20_000 }).catch(() => {});
    await settle(p, 3000);
    await shot(p, "souterrain-hic");
    results.souterrain_hic = { state: await state(p), instances: await p.evaluate(() => (window as any).__aqueduc.tubes.stats.instances), errors };
    await p.close();
  }

  // 6. arbre d'accessibilité et focus au clavier, dans les deux modes (vue d'ouverture)
  for (const mode of ["classic", "hic"] as const) {
    const { p } = await open(ctx, mode);
    const aria = await p.locator("body").ariaSnapshot();
    results[`aria_${mode}`] = aria.split("\n").filter((l) => /(Pression|Débit|Réservoir|Point de mesure).*\(simulation\)|Centre-ville/.test(l)).slice(0, 8).map((l) => l.trim());
    results[`focus_${mode}`] = await keyboardFocus(p, mode);
    await p.close();
  }

  // 7. export vidéo de la séquence (10 s) et image à 5 s : marquages dans le cadre en HTML-in-Canvas seulement
  for (const mode of ["classic", "hic"] as const) results[`video_${mode}`] = await exportVideo(ctx, mode);
  await ctx.close();
  copyFileSync(`${OUT}/video-hic.webm`, PUBLIC_VIDEO);
  results.publicVideo = { file: PUBLIC_VIDEO, octets: statSync(PUBLIC_VIDEO).size };

  // 8. sans l'API : mode classique, bandeau (avec le bouton vidéo, le fichier existant maintenant)
  const nb = await chromium.launch({ args: ["--disable-blink-features=CanvasDrawElement"] });
  {
    const p = await nb.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
    await p.goto(`${BASE}/?mode=hic`);
    await p.waitForFunction(() => (window as any).__aqueduc?.store.getState().live.t > 0, null, { timeout: 60_000 });
    await p.locator("[data-testid=noapi]").waitFor({ timeout: 8_000 }).catch(() => {});
    await p.getByRole("button", { name: "Voir la version HTML-in-Canvas en vidéo" }).waitFor({ timeout: 8_000 }).catch(() => {});
    await settle(p, 2500);
    await shot(p, "sans-api");
    results.sans_api = {
      state: await state(p),
      hicLayer: await p.evaluate(() => (window as any).__hicMap?.layer ?? null),
      bandeau: await p.locator("[data-testid=noapi]").innerText().catch(() => ""),
      boutonVideo: await p.getByRole("button", { name: "Voir la version HTML-in-Canvas en vidéo" }).count(),
    };
  }
  await nb.close();

  writeFileSync(`${OUT}/proofs.json`, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
