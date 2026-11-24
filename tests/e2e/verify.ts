/**
 * Vérification de bout en bout (Chromium de Playwright, serveur sur BASE_URL).
 *   npx tsx tests/e2e/verify.ts            # les deux modes + repli + SSR sans JS
 * Sortie : une ligne OK/ÉCHEC par point de contrôle ; code de sortie 1 si un échec.
 */
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS; // dossier optionnel pour les captures d'écran
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${name}${detail ? ` — ${detail}` : ""}`);
}

const wall = (p: Page) => p.waitForFunction(() => (window as any).__wall, null, { timeout: 30_000 });
const state = (p: Page) => p.evaluate(() => { const s = (window as any).__wall.ui.getState(); return { mode: s.mode, api: s.api, fallback: s.fallback, level: s.level }; });
const fly = (p: Page, c: number, zoom: number, dx = 0.5, dy = 0.5) =>
  p.evaluate(([c, zoom, dx, dy]) => { const w = (window as any).__wall; const r = w.cardRect(c); return w.flyTo({ x: r.x + r.w * dx, y: r.y + r.h * dy, zoom }, 0); }, [c, zoom, dx, dy] as const);

/** Le pixel du canvas au centre d'un élément n'est pas noir (le canvas affiche bien la texture). */
async function canvasPixelAt(p: Page, sel: string) {
  return p.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const cv = document.querySelector<HTMLCanvasElement>(".wall-canvas")!;
    const r = el.getBoundingClientRect();
    const c = cv.getBoundingClientRect();
    const gl = cv.getContext("webgl2")!;
    // le tampon n'est pas préservé : on lit pendant le prochain paint, juste après le dessin
    return new Promise<number[]>((resolve) => {
      cv.addEventListener("paint", () => queueMicrotask(() => {
        const px = new Uint8Array(4);
        const s = cv.width / cv.clientWidth;
        gl.readPixels(Math.round((r.left - c.left + r.width / 2) * s), Math.round(cv.height - (r.top - c.top + r.height / 2) * s), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        resolve(Array.from(px));
      }), { once: true });
      (window as any).__wall.camera.set({});
    });
  }, sel);
}

async function runMode(b: Browser, mode: "dom" | "canvas") {
  console.log(`\n== Mode ${mode}`);
  const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/?mode=${mode}&n=1000`);
  await wall(p);
  await p.waitForTimeout(1500);
  const st = await state(p);
  check(`${mode} : mode actif`, st.mode === mode, JSON.stringify(st));

  // --- 40 % : niveau intermédiaire, clic sur une carte => panneau complet, saisie
  const card40 = 5; // succursale S002, ventes
  await fly(p, card40, 0.4);
  await p.waitForTimeout(800);
  check(`${mode} : 40 % => niveau intermédiaire`, (await state(p)).level === 1);
  const mid = p.locator(`[data-card="${card40}"][data-level="1"]`);
  await mid.click();
  const ta40 = p.locator(`textarea[data-note="S002:sales"]`);
  await ta40.waitFor({ timeout: 5000 });
  await ta40.click();
  const focused40 = await p.evaluate(() => document.activeElement?.getAttribute("data-note"));
  check(`${mode} : clic dans la carte à 40 %`, focused40 === "S002:sales", `focus=${focused40}`);
  const note40 = `note 40% ${mode} ${Date.now() % 10000}`;
  await p.keyboard.type(note40);
  check(`${mode} : saisie à 40 %`, (await ta40.inputValue()) === note40);
  if (mode === "canvas") {
    await p.waitForTimeout(300);
    const px = await canvasPixelAt(p, `textarea[data-note="S002:sales"]`);
    check("canvas : pixel affiché sous la note non noir", px[0] + px[1] + px[2] > 0, JSON.stringify(px));
  }
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/verify-${mode}-40.png` });
  await p.keyboard.press("Escape"); // quitte le champ ? Escape dans textarea ne ferme pas : clic hors carte
  await p.evaluate(() => (window as any).__wall.ui.setState({ pinned: [] }));

  // --- 100 % : niveau rapproché
  const card100 = 0;
  await fly(p, card100, 1, 1.4, 1.3);
  await p.waitForTimeout(800);
  check(`${mode} : 100 % => niveau rapproché`, (await state(p)).level === 2);
  const ta = p.locator(`textarea[data-note="S001:sales"]`);
  await ta.click();
  await p.keyboard.press("Control+A");
  const note100 = `note 100% ${mode} ${Date.now() % 10000}`;
  await p.keyboard.type(note100);
  check(`${mode} : clic + saisie à 100 %`, (await ta.inputValue()) === note100);
  // Tab : textarea -> select -> bouton -> champ de la carte suivante
  const order: string[] = [];
  for (let i = 0; i < 3; i++) {
    await p.keyboard.press("Tab");
    order.push(await p.evaluate(() => { const a = document.activeElement!; return `${a.tagName.toLowerCase()}:${a.closest("[data-card]")?.getAttribute("data-card") ?? "-"}`; }));
  }
  check(`${mode} : Tab atteint les champs des cartes rapprochées`, order[0] === "select:0" && order[1] === "button:0" && order[2].startsWith("textarea:"), order.join(" → "));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/verify-${mode}-100.png` });

  if (mode === "canvas") {
    const hic = await p.evaluate(() => (window as any).__hic?.stats());
    check("canvas : API active et vérifiée (readPixels)", (await state(p)).api === "active", JSON.stringify(hic));
    const hit = await p.evaluate(() => { const r = document.querySelector('textarea[data-note="S001:sales"]')!.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.getAttribute("data-note"); });
    check("canvas : hit testing (elementFromPoint) sur la note", hit === "S001:sales");
  }
  // --- persistance : attendre la Server Action puis recharger
  await p.waitForTimeout(1500);
  await p.reload();
  await wall(p);
  await fly(p, card100, 1, 1.4, 1.3);
  await p.waitForTimeout(1500);
  const after = await p.locator(`textarea[data-note="S001:sales"]`).inputValue();
  check(`${mode} : note visible après rechargement`, after === note100, `"${after}"`);

  // --- robot
  await p.getByRole("button", { name: "Voir ce que voit un robot" }).click();
  await p.waitForTimeout(500);
  const robot = await p.locator(".robot pre").innerText();
  check(`${mode} : vue robot contient les champs des cartes`, robot.includes("textbox") && robot.includes("Note d'équipe S001:sales"), `${robot.length} caractères`);
  check(`${mode} : aucune erreur JS`, errors.length === 0, errors.join(" | "));
  await p.close();
}

async function main() {
  const b = await chromium.launch();
  await runMode(b, "dom");
  await runMode(b, "canvas");
  await b.close();

  console.log("\n== Chrome sans l'API (--disable-blink-features=CanvasDrawElement)");
  const nf = await chromium.launch({ args: ["--disable-blink-features=CanvasDrawElement"] });
  const p = await nf.newPage();
  await p.goto(`${BASE}/?mode=canvas`);
  await wall(p);
  await p.waitForTimeout(800);
  const st = await state(p);
  const msg = await p.locator('[data-testid="fallback"]').innerText().catch(() => "");
  check("sans API : bascule automatique en mode DOM", st.mode === "dom" && st.api === "absente");
  check("sans API : message clair affiché", msg.includes("API HTML-in-Canvas absente"), msg);
  await nf.close();

  console.log("\n== JavaScript désactivé");
  const b2 = await chromium.launch();
  const ctx = await b2.newContext({ javaScriptEnabled: false });
  const q = await ctx.newPage();
  await q.goto(`${BASE}/`);
  const txt = (await q.locator("aside.overview").textContent()) ?? "";
  check("sans JS : vue d'ensemble SSR (régions, critiques, alertes)", txt.includes("Région Aster") && txt.includes("Critiques") && txt.includes("Indicateurs critiques"));
  await b2.close();

  console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert.");
  process.exit(failures ? 1 : 0);
}
main();
