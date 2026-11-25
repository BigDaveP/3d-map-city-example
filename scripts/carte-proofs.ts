/**
 * Preuves de CAPABILITIES.md : captures d'écran, vidéos et résultats de tests, mêmes scènes
 * dans les deux modes.
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/carte-proofs.ts
 *
 * Sorties : docs/carte/*.png, docs/carte/*.webm, docs/carte/proofs.json.
 * Sur une machine avec GPU, lancer Chrome avec le flag (voir README) ; ici Chromium de Playwright.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "docs/carte";
const HEADED = process.env.HEADED === "1";
const VIEW = { width: 1200, height: 760 };
mkdirSync(OUT, { recursive: true });
const results: Record<string, unknown> = {};

/** Caméra au sud de la tour de la Place Ville-Marie : le restaurant R03 (idx 2) est derrière. */
const CAM_OCCLUDED = { center: [-73.569, 45.4995], zoom: 16.3, pitch: 65, bearing: 0 };
/** Vue d'ensemble inclinée du centre-ville. */
const CAM_OVERVIEW = { center: [-73.5672, 45.5045], zoom: 15.9, pitch: 62, bearing: -25 };

async function open(b: Browser, mode: "classic" | "hic", args: { cam: object; restaurants: number[]; couriers?: number[]; orientation?: string; transition?: string }) {
  const p = await b.newPage({ viewport: VIEW });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/carte?mode=${mode}`);
  await p.waitForFunction(() => (window as any).__carte, null, { timeout: 60_000 });
  await p.evaluate(
    (a: any) => {
      const c = (window as any).__carte;
      c.store.setState({ pulse: false, orientation: a.orientation ?? "billboard", transition: a.transition ?? "none", openRestaurants: a.restaurants, openCouriers: a.couriers ?? [] });
      c.map.jumpTo(a.cam);
    },
    args as never,
  );
  await p.waitForFunction(() => (window as any).__map.areTilesLoaded(), null, { timeout: 60_000 }).catch(() => {});
  await p.waitForTimeout(3500);
  return { p, errors };
}

const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.png` });

async function textareaCenter(p: Page, id: string) {
  const b = await p.locator(`textarea[data-note="${id}"]`).boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}

async function main() {
  const b = await chromium.launch({ headless: !HEADED, args: ["--enable-blink-features=CanvasDrawElement"] });

  // 1. perspective : dix panneaux, même caméra
  for (const mode of ["classic", "hic"] as const) {
    const { p } = await open(b, mode, { cam: CAM_OVERVIEW, restaurants: [0, 1, 2, 3, 5, 6, 9, 13, 14, 7] });
    await shot(p, `perspective-${mode}`);
    await p.close();
  }
  {
    const { p } = await open(b, "hic", { cam: CAM_OVERVIEW, restaurants: [0, 1, 2, 3, 5, 6, 9, 13, 14, 7], orientation: "facade" });
    await shot(p, "facade-hic");
    await p.close();
  }

  // 2. occlusion + 3. clic sur la partie masquée
  for (const mode of ["classic", "hic"] as const) {
    const { p, errors } = await open(b, mode, { cam: CAM_OCCLUDED, restaurants: [2] });
    await shot(p, `occlusion-${mode}`);
    const c = await textareaCenter(p, "R03");
    const r: Record<string, unknown> = { textarea: c };
    if (c) {
      r.elementFromPoint = await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName.toLowerCase(), c);
      await p.mouse.move(c.x, c.y);
      await p.waitForTimeout(1500);
      await p.mouse.down();
      await p.mouse.up();
      await p.waitForTimeout(300);
      r.focusApresClic = await p.evaluate(() => document.activeElement?.tagName.toLowerCase() + (document.activeElement?.getAttribute("data-note") ? `:${document.activeElement.getAttribute("data-note")}` : ""));
      r.occlusionStats = await p.evaluate(() => (window as any).__occlusion ?? null);
    }
    // ce qu'un humain voit au centre de la note : la tour (masquée) ou le panneau ?
    r.errors = errors;
    results[`clicMasque_${mode}`] = r;
    await p.close();
  }

  // 4. saisie et focus dans un panneau incliné + Tab + focus d'un panneau masqué (rayons X)
  {
    const { p, errors } = await open(b, "hic", { cam: { center: [-73.569, 45.5032], zoom: 16.4, pitch: 50, bearing: 200 }, restaurants: [2, 1] });
    const c = await textareaCenter(p, "R03");
    const r: Record<string, unknown> = {};
    if (c) {
      await p.mouse.move(c.x, c.y);
      await p.waitForTimeout(1500);
      await p.mouse.click(c.x, c.y);
      await p.keyboard.press("Control+A");
      await p.keyboard.type("Saisie dans un panneau incliné");
      r.focus = await p.evaluate(() => document.activeElement?.getAttribute("data-note"));
      r.valeur = await p.locator('textarea[data-note="R03"]').inputValue();
      const order: string[] = [];
      for (let i = 0; i < 3; i++) {
        await p.keyboard.press("Tab");
        order.push(await p.evaluate(() => { const a = document.activeElement!; return `${a.tagName.toLowerCase()}@${a.closest("[data-panel]")?.getAttribute("data-panel") ?? "-"}`; }));
      }
      r.tab = order;
      await p.waitForTimeout(1500);
      await shot(p, "focus-tab-hic");
    }
    r.errors = errors;
    results.saisie_hic = r;
    await p.close();
  }
  {
    // panneau masqué qui reçoit le focus au clavier : la caméra se recentre, rayons X
    const { p } = await open(b, "hic", { cam: CAM_OCCLUDED, restaurants: [2] });
    await p.evaluate(() => (document.querySelector('textarea[data-note="R03"]') as HTMLElement).focus());
    await p.waitForTimeout(2500);
    await shot(p, "focus-xray-hic");
    results.focusMasque_hic = { focus: await p.evaluate(() => document.activeElement?.getAttribute("data-note")) };
    await p.close();
  }

  // 5. lecteur d'écran : arbre d'accessibilité (snapshot ARIA de Playwright)
  for (const mode of ["classic", "hic"] as const) {
    const { p } = await open(b, mode, { cam: CAM_OVERVIEW, restaurants: [2] });
    results[`aria_${mode}`] = await p.locator("body").ariaSnapshot().then((s) => s.split("\n").filter((l) => /Brasserie Corvelac|Note pour|Mettre en pause|Envoyer un livreur/.test(l)).slice(0, 8));
    await p.close();
  }

  // 6. transition shader pendant laquelle le panneau reste interactif
  for (const transition of ["dissolve", "sweep"]) {
    const { p } = await open(b, "hic", { cam: { center: [-73.569, 45.5032], zoom: 16.4, pitch: 50, bearing: 200 }, restaurants: [], transition });
    // transition allongée à 5 s pour la photographier en cours, malgré le rendu logiciel
    await p.evaluate(() => (window as any).__carte.store.setState({ transitionMs: 5000, openRestaurants: [2] }));
    await p.waitForFunction(() => (window as any).__hicMap?.layer?.panels.get("r2")?.tex, null, { timeout: 15_000 });
    await p.waitForTimeout(1800);
    await shot(p, `transition-${transition}-hic`);
    const c = await textareaCenter(p, "R03");
    if (c && transition === "dissolve") {
      // clic pendant la transition (le panneau est monté et sa géométrie est déjà à jour)
      await p.evaluate(() => (window as any).__carte.store.setState({ openRestaurants: [] }));
      await p.waitForTimeout(500);
      await p.evaluate(() => (window as any).__carte.store.setState({ openRestaurants: [2] }));
      await p.waitForFunction(() => (window as any).__hicMap?.layer?.panels.get("r2")?.tex, null, { timeout: 15_000 });
      const c2 = await textareaCenter(p, "R03");
      if (c2) {
        await p.mouse.move(c2.x, c2.y);
        await p.waitForTimeout(200);
        await p.mouse.click(c2.x, c2.y);
        results.transitionInteractive = {
          focus: await p.evaluate(() => document.activeElement?.getAttribute("data-note")),
          // avancement de la transition au moment du clic (0..1) : preuve que le clic a eu lieu pendant
          avancement: await p.evaluate(() => { const pn = (window as any).__hicMap?.layer?.panels.get("r2"); return pn ? Math.min(1, (performance.now() - pn.openedAt) / 5000) : 0; }),
        };
      }
    }
    await p.close();
  }

  // 7. export vidéo (10 s) puis une image extraite de la vidéo
  for (const mode of ["classic", "hic"] as const) {
    const { p } = await open(b, mode, { cam: CAM_OVERVIEW, restaurants: [0, 1, 2, 3, 13, 14], transition: "none" });
    const dl = p.waitForEvent("download", { timeout: 60_000 });
    await p.click("#export-video");
    const d = await dl;
    await d.saveAs(`${OUT}/video-${mode}.webm`);
    const frame = await p.evaluate(async () => {
      const v = document.createElement("video");
      v.src = (window as any).__lastVideo.url;
      v.muted = true;
      await new Promise((r) => (v.onloadeddata = r));
      v.currentTime = 5;
      await new Promise((r) => (v.onseeked = r));
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      return { png: c.toDataURL("image/png"), w: v.videoWidth, h: v.videoHeight, size: (window as any).__lastVideo.size };
    });
    writeFileSync(`${OUT}/video-${mode}-image-5s.png`, Buffer.from(frame.png.split(",")[1], "base64"));
    results[`video_${mode}`] = { w: frame.w, h: frame.h, octets: frame.size };
    await p.close();
  }

  // 8. sélection et copier-coller du texte d'un panneau
  for (const mode of ["classic", "hic"] as const) {
    const ctx = await b.newContext({ viewport: VIEW, permissions: ["clipboard-read", "clipboard-write"] });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/carte?mode=${mode}`);
    await p.waitForFunction(() => (window as any).__carte, null, { timeout: 60_000 });
    await p.evaluate(() => {
      const c = (window as any).__carte;
      c.store.setState({ pulse: false, transition: "none", openRestaurants: [2] });
      c.map.jumpTo({ center: [-73.569, 45.5032], zoom: 16.4, pitch: 50, bearing: 200 });
    });
    await p.waitForTimeout(4000);
    const title = p.locator('[data-panel="r2"] header strong');
    const bb = await title.boundingBox();
    const r: Record<string, unknown> = {};
    if (bb) {
      // valeur témoin : un presse-papiers inchangé ne doit pas passer pour une copie réussie
      await p.evaluate(() => navigator.clipboard.writeText("(témoin)"));
      await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await p.waitForTimeout(1500);
      await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { clickCount: 3 });
      r.selectionTexte = await p.evaluate(() => window.getSelection()?.toString().trim());
      await p.keyboard.press("Control+C");
      r.copieTexte = await p.evaluate(() => navigator.clipboard.readText().catch((e) => `erreur : ${e.message}`));
      await p.waitForTimeout(600);
      await shot(p, `selection-${mode}`);
      // texte saisi dans un champ : Ctrl+A puis Ctrl+C dans la textarea
      await p.evaluate(() => navigator.clipboard.writeText("(témoin)"));
      const ta = p.locator('textarea[data-note="R03"]');
      const tb = await ta.boundingBox();
      if (tb) {
        await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
        await p.waitForTimeout(1500);
        await p.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
        await p.keyboard.press("Control+A");
        await p.keyboard.type("texte à copier");
        await p.keyboard.press("Control+A");
        await p.keyboard.press("Control+C");
        r.copieChamp = await p.evaluate(() => navigator.clipboard.readText().catch((e) => `erreur : ${e.message}`));
      }
    }
    results[`selection_${mode}`] = r;
    await ctx.close();
  }
  await b.close();

  // 9. sans l'API : repli automatique
  const nb = await chromium.launch({ args: ["--disable-blink-features=CanvasDrawElement"] });
  {
    const p = await nb.newPage({ viewport: VIEW });
    await p.goto(`${BASE}/carte?mode=hic`);
    await p.waitForFunction(() => (window as any).__carte, null, { timeout: 60_000 });
    await p.evaluate(() => (window as any).__carte.store.setState({ openRestaurants: [2], pulse: false }));
    await p.waitForTimeout(4000);
    await shot(p, "repli-sans-api");
    results.repli = await p.evaluate(() => { const s = (window as any).__carte.store.getState(); return { mode: s.mode, api: s.api, message: s.fallback }; });
  }
  await nb.close();

  writeFileSync(`${OUT}/proofs.json`, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
