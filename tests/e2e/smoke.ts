/**
 * Vérification rapide de bout en bout (Chromium de Playwright, serveur sur BASE_URL).
 *   BASE_URL=http://localhost:3300 npx tsx tests/e2e/smoke.ts
 *   SHOT=chemin.png pour enregistrer une capture de la page d'accueil (mode classique, 1440 × 860) ;
 *   SHOT_HIC=chemin.png pour la même vue en mode HTML-in-Canvas.
 * Sortie : une ligne OK/ÉCHEC par point de contrôle ; code de sortie 1 si un échec.
 * Les tuiles viennent d'OpenFreeMap : chargements courts, une seule vue par page.
 */
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Erreurs de la page : exceptions et messages console de niveau erreur. */
function collectErrors(p: Page) {
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(`exception : ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console : ${m.text()}`));
  return errors;
}

async function ssrWithoutJs(b: Browser) {
  console.log("\n== / sans JavaScript");
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const res = await p.goto(`${BASE}/`);
  check("statut 200", res?.status() === 200, String(res?.status()));
  const text = await p.locator("body").innerText();
  check("« Ville de Trois-Rivières » (attribution)", text.includes("Ville de Trois-Rivières"));
  check("« Simulation »", text.includes("Simulation"));
  check("titre de la page", (await p.title()).includes("Réseau d'eau potable"), await p.title());
  check("secteurs listés avec statut", (await p.locator(".aq-table tbody tr").count()) === 10);
  check("lien vers les autres démos", (await p.locator('nav a[href="/mur"]').count()) === 1);
  await ctx.close();
}

async function narrow(b: Browser, js: boolean) {
  console.log(`\n== 390 px ${js ? "avec" : "sans"} JavaScript`);
  const ctx = await b.newContext({ javaScriptEnabled: js, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/`);
  if (js) {
    await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 30_000 });
    await p.waitForTimeout(800);
  }
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  check("aucun défilement horizontal (scrollWidth = 390)", w === 390, `scrollWidth ${w}`);
  if (js) check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Étiquettes de capteurs affichées (DOM ou surfaces) : identifiant, type et statut courant. */
async function shownTags(p: Page) {
  return p.evaluate(() => {
    const { store, net } = (window as any).__aqueduc;
    const st = store.getState();
    return [...document.querySelectorAll<HTMLElement>("[data-sensor]")].map((e) => {
      const s = net.sensorById.get(e.dataset.sensor);
      return { id: s.id as string, kind: s.kind as string, st: (st.live.readings[s.idx]?.[1] ?? 0) as number, values: e.querySelectorAll(".aq-num").length };
    });
  });
}
/** Règle R13 : au plus 8 étiquettes, une valeur chacune, toutes pertinentes pour la couche (ou en attention / alerte). */
function relevant(tags: Awaited<ReturnType<typeof shownTags>>, kinds: string[]) {
  return tags.length <= 8 && tags.every((t) => t.values === 1 && (kinds.includes(t.kind) || t.st > 0));
}

/** Point de l'écran sur la conduite `id`, non couvert par une étiquette DOM. */
async function pointOnPipe(p: Page, id: string) {
  return p.evaluate(async (id) => {
    const { map, net } = (window as any).__aqueduc;
    const f = net.data.segments.features[net.segById.get(id)];
    const c: [number, number][] = f.geometry.coordinates;
    map.jumpTo({ center: c[Math.floor(c.length / 2)], zoom: 18.2, pitch: 45 });
    await new Promise((r) => map.once("idle", r));
    const canvas = map.getCanvas() as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    for (let k = 1; k < c.length; k++)
      for (const u of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const pt = map.project([c[k - 1][0] + (c[k][0] - c[k - 1][0]) * u, c[k - 1][1] + (c[k][1] - c[k - 1][1]) * u]);
        const hit = map.queryRenderedFeatures([pt.x, pt.y], { layers: ["aq-pipes", "aq-sensors"] })[0];
        const el = document.elementFromPoint(box.left + pt.x, box.top + pt.y);
        if (hit?.layer.id === "aq-pipes" && hit.properties.id === id && el === canvas) return { x: box.left + pt.x, y: box.top + pt.y };
      }
    return null;
  }, id);
}

async function classic(b: Browser) {
  console.log("\n== / avec JavaScript, mode classique");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/?mode=classic`);
  await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
  check("vue SSR masquée une fois l'application montée", !(await p.locator(".aq-ssr").isVisible()));
  const st = await p.evaluate(() => (window as any).__aqueduc.store.getState().mode);
  check("mode classique", st === "classic", st);
  await p.waitForFunction(() => (window as any).__aqueduc.store.getState().live.t > 0, null, { timeout: 15_000 });
  const live = await p.evaluate(() => {
    const { store, net } = (window as any).__aqueduc;
    const s = store.getState();
    return { readings: s.live.readings.length, pressure: s.live.pressure.length, demo: net.data.demoSegments.length, sensors: net.data.sensors.length };
  });
  check("flux SSE : lectures de tous les capteurs", live.readings === live.sensors, JSON.stringify(live));
  check("flux SSE : pression alignée sur demoSegments", live.pressure === live.demo && live.demo > 0);
  const tags = await shownTags(p);
  check("étiquettes DOM : couche Pression, 8 au plus, une valeur chacune", tags.length > 0 && relevant(tags, ["pression", "debit", "reservoir"]), tags.map((t) => t.id).join(" "));
  await p.evaluate(() => (window as any).__aqueduc.store.setState({ layer: "age" }));
  await p.waitForTimeout(500);
  const ageTags = await shownTags(p);
  check("couche Âge : seulement les capteurs en attention ou en alerte", ageTags.every((t) => t.st > 0), ageTags.map((t) => `${t.id}:${t.st}`).join(" ") || "aucune");
  await p.evaluate(() => (window as any).__aqueduc.store.setState({ layer: "pression" }));
  const sector = await p.locator(".aq-flat .aq-mark-sector", { hasText: "CENTRE-VILLE" }).innerText().catch(() => "");
  check("étiquette plate du secteur Centre-ville (un seul chiffre)", /adresses desservies/.test(sector) && (sector.match(/\d[\d\s]*/g) ?? []).length === 1, sector.replace(/\n/g, " "));
  check("pas de fiche sans sélection", (await p.locator("[data-testid=inspector]").count()) === 0);
  await p.waitForFunction(() => document.querySelector(".aq-tl-past")?.getAttribute("d")?.startsWith("M"), null, { timeout: 15_000 });
  check("frise : courbe de 24 h tracée", true);

  if (process.env.SHOT) {
    await p.evaluate(async () => {
      const { map } = (window as any).__aqueduc;
      await new Promise((r) => (map.loaded() ? r(null) : map.once("idle", r)));
    });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: process.env.SHOT });
    console.log(`capture : ${process.env.SHOT}`);
  }

  const pt = await pointOnPipe(p, "13C1949");
  check("13C1949 visible et cliquable", !!pt);
  if (pt) {
    await p.mouse.click(pt.x, pt.y);
    const insp = p.locator("[data-testid=inspector]");
    await insp.waitFor({ timeout: 5_000 }).catch(() => {});
    const text = (await insp.count()) ? await insp.innerText() : "";
    for (const s of ["13C1949", "300 mm", "Fonte grise", "1920"]) check(`fiche : « ${s} »`, text.includes(s));
    await p.keyboard.press("Escape");
    check("Échap ferme la fiche", (await insp.count()) === 0);
  }
  // recherche par identifiant de capteur : la fiche du capteur s'ouvre
  await p.locator(".aq-search input").fill("P-01");
  await p.keyboard.press("Enter");
  const found = await p.locator("[data-testid=inspector]").innerText({ timeout: 5_000 }).catch(() => "");
  check("recherche « P-01 » → fiche du capteur", found.includes("P-01") && found.includes("Seuil"), found.slice(0, 60).replace(/\n/g, " "));
  await p.keyboard.press("Escape");
  if (process.env.SHOT_SELECTED && pt) {
    await p.mouse.click(pt.x, pt.y);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: process.env.SHOT_SELECTED });
    console.log(`capture : ${process.env.SHOT_SELECTED}`);
  }
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Page d'accueil en mode HTML-in-Canvas : secteurs et capteurs dans la scène, clics avec occlusion. */
async function homeHic(b: Browser) {
  console.log("\n== /?mode=hic (HTML-in-Canvas : secteurs et capteurs dans la scène)");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  await p.waitForFunction(() => (window as any).__aqueduc.store.getState().live.t > 0, null, { timeout: 15_000 });
  // toutes les surfaces montées capturées au moins une fois (8 au plus par paint)
  const captured = await p
    .waitForFunction(() => {
      const w = window as any;
      const s = w.__hicMap.stats();
      const panels = [...w.__hicMap.layer.panels.values()];
      return panels.length > 0 && panels.every((q: any) => q.tex) && s.verified >= 3;
    }, null, { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  const r = await p.evaluate(() => {
    const w = window as any;
    const st = w.__aqueduc.store.getState();
    const stats = w.__hicMap.stats();
    const keys: string[] = [...w.__hicMap.layer.panels.keys()];
    const values = [...document.querySelectorAll('.maplibregl-canvas > [data-panel^="sensor:"]')].map((e) => e.querySelectorAll(".aq-num").length);
    return { mode: st.mode, fallback: st.fallback || stats.fallback || "", api: st.api, uploads: stats.uploads, verified: stats.verified, keys, values, markers: document.querySelectorAll(".maplibregl-marker").length };
  });
  const sensors = r.keys.filter((k) => k.startsWith("sensor:")).length;
  const tags = await shownTags(p);
  check("surfaces montées : marquage du Centre-ville et étiquettes de capteurs", r.keys.includes("sector:centre-ville") && sensors > 0 && sensors === tags.length, `${r.keys.length} surfaces, ${sensors} étiquettes : ${tags.map((t) => t.id).join(" ")}`);
  check("étiquettes pertinentes (couche Pression, 8 au plus)", relevant(tags, ["pression", "debit", "reservoir"]));
  check("toutes les surfaces capturées, vérifiées par readPixels", captured && r.uploads >= r.keys.length && r.verified >= 3, `uploads ${r.uploads}, verified ${r.verified}`);
  check("pas de repli en mode classique", r.mode === "hic" && !r.fallback, r.fallback || r.mode);
  check("API marquée active après vérification", r.api === "active", r.api);
  check("une seule valeur par étiquette de capteur", r.values.length === sensors && r.values.every((n) => n === 1));
  check("aucun marqueur DOM du mode classique", r.markers === 0, String(r.markers));
  await p.waitForTimeout(1500);

  if (process.env.SHOT_HIC) {
    // après les premières captures : la puce de performance ne montre plus le coût du démarrage
    await p.waitForTimeout(4000);
    await p.screenshot({ path: process.env.SHOT_HIC });
    console.log(`capture : ${process.env.SHOT_HIC}`);
  }

  // clic sur une étiquette de capteur visible, qu'aucune autre surface ne recouvre
  const tag = await p.evaluate(() => {
    const L = (window as any).__hicMap.layer;
    const canvas = (window as any).__aqueduc.map.getCanvas() as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const panels = [...L.panels.values()] as any[];
    for (const q of panels) {
      if (!q.key.startsWith("sensor:") || q.visible !== true || !q.proj) continue;
      const [x, y] = q.proj.project(q.w / 2, q.h / 2);
      if (x < 260 || x > box.width - 280 || y < 40 || y > box.height - 150) continue;
      const covered = panels.some((o) => {
        if (o === q || !o.proj) return false;
        const uv = o.proj.unproject(x, y);
        return uv && uv[0] >= 0 && uv[1] >= 0 && uv[0] <= o.w && uv[1] <= o.h;
      });
      if (!covered) return { key: q.key as string, x: box.left + x, y: box.top + y };
    }
    return null;
  });
  check("une étiquette de capteur visible et dégagée", !!tag);
  if (tag) {
    await p.mouse.move(tag.x, tag.y);
    await p.waitForTimeout(800);
    await p.mouse.click(tag.x, tag.y);
    const id = tag.key.slice("sensor:".length);
    const text = await p.locator("[data-testid=inspector]").innerText({ timeout: 5_000 }).catch(() => "");
    check(`clic sur l'étiquette ${id} → fiche du capteur`, text.includes(id) && text.includes("Seuil"), text.slice(0, 60).replace(/\n/g, " "));
    await p.keyboard.press("Escape");
  }

  // Points du marquage du Centre-ville sur un glyphe opaque : texels lus dans la texture capturée
  // (le shader écarte les texels transparents, qui seraient « masqués » quoi qu'il arrive).
  // « masqué » : un bâtiment au point et à ±6 px ; « dégagé » : aucun bâtiment à ±10 px.
  const glyphs = await p.evaluate(() => {
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
    let opaque = 0;
    for (let v = 3; v < q.h - 3; v += 2)
      for (let u = 3; u < q.w - 3; u += 2) {
        // glyphe plein : texels opaques sur un carré de 5 × 5
        let full = true;
        for (let dv = -2; dv <= 2 && full; dv++)
          for (let du = -2; du <= 2 && full; du++) full = px[(Math.round((v + dv) * scale) * tw + Math.round((u + du) * scale)) * 4 + 3] >= 200;
        if (!full) continue;
        opaque++;
        const [x, y] = q.proj.project(u, v);
        if (x < 260 || x > box.width - 20 || y < 40 || y > box.height - 150) continue;
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
    return { hidden, open, opaque };
  });
  check("texels opaques lus dans la texture du marquage", (glyphs?.opaque ?? 0) > 100, String(glyphs?.opaque));
  const clickAt = async (pt: { x: number; y: number }) => {
    const before = await p.evaluate(() => ({ ...(window as any).__occlusion }));
    await p.mouse.move(pt.x, pt.y);
    // requête d'occlusion : une à deux images (lente sans GPU)
    await p.waitForTimeout(800);
    await p.mouse.click(pt.x, pt.y);
    await p.waitForTimeout(300);
    return p.evaluate((b) => {
      const w = window as any;
      return { pass: w.__occlusion.passThrough - b.passThrough, occ: w.__occlusion, sel: w.__aqueduc.store.getState().selection };
    }, before);
  };
  // témoin : un glyphe dégagé reçoit le clic et sélectionne le secteur
  check("un glyphe dégagé du marquage du Centre-ville", !!glyphs?.open);
  if (glyphs?.open) {
    const r = await clickAt(glyphs.open);
    check("clic sur le glyphe dégagé → secteur Centre-ville sélectionné", r.pass === 0 && r.sel?.kind === "sector" && r.sel.id === "centre-ville", `${JSON.stringify(r.occ)} · sélection ${JSON.stringify(r.sel)}`);
    await p.keyboard.press("Escape");
  }
  // un glyphe masqué par un bâtiment (quelle que soit sa hauteur) : le clic traverse vers la carte
  check("un bâtiment masque un glyphe du marquage du Centre-ville", !!glyphs?.hidden);
  if (glyphs?.hidden) {
    const r = await clickAt(glyphs.hidden);
    check("clic sur le glyphe masqué : passThrough ≥ 1, transmis à la carte", r.pass >= 1 && r.sel?.kind !== "sector", `${JSON.stringify(r.occ)} · sélection ${JSON.stringify(r.sel)}`);
  }
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** /carte en mode HTML-in-Canvas : 5 panneaux capturés, vérifiés par readPixels, sans repli. */
async function carteHic(b: Browser) {
  console.log("\n== /carte?mode=hic (HTML-in-Canvas)");
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/carte?mode=hic`);
  await p.waitForFunction(() => (window as any).__carte && (window as any).__hicMap, null, { timeout: 45_000 });
  await p.evaluate(() => (window as any).__carte.openPanels(5, 0));
  const ok = await p
    .waitForFunction(() => {
      const s = (window as any).__hicMap?.stats();
      return s && s.uploads >= 5 && s.verified >= 3;
    }, null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  const r = await p.evaluate(() => {
    const w = window as any;
    const st = w.__carte.store.getState();
    const stats = w.__hicMap?.stats() ?? {};
    return { mode: st.mode, fallback: st.fallback || stats.fallback || "", api: st.api, uploads: stats.uploads, verified: stats.verified, panels: w.__hicMap?.layer.panels.size };
  });
  check("uploads ≥ 5 et verified ≥ 3", ok && r.uploads >= 5 && r.verified >= 3, `uploads ${r.uploads}, verified ${r.verified}`);
  check("5 panneaux dans la couche", r.panels === 5, String(r.panels));
  check("pas de repli en mode classique", r.mode === "hic" && !r.fallback, r.fallback || r.mode);
  check("API marquée active après vérification", r.api === "active", r.api);
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

async function otherPages() {
  console.log("\n== Autres démos");
  for (const path of ["/mur", "/carte", "/bench"]) {
    const r = await fetch(`${BASE}${path}`);
    check(`${path} → 200`, r.status === 200, String(r.status));
  }
}

const b = await chromium.launch();
try {
  await ssrWithoutJs(b);
  await narrow(b, false);
  await narrow(b, true);
  await classic(b);
  await homeHic(b);
  await carteHic(b);
  await otherPages();
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert.");
process.exit(failures ? 1 : 0);
