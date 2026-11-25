/**
 * Vérification rapide de bout en bout (Chromium de Playwright, serveur sur BASE_URL).
 *   BASE_URL=http://localhost:3300 npx tsx tests/e2e/smoke.ts
 *   SHOT=chemin.png pour enregistrer une capture de la page d'accueil (mode classique, 1440 × 860) ;
 *   SHOT_HIC=chemin.png pour la même vue en mode HTML-in-Canvas ;
 *   SHOT_SCENARIO_HIC / SHOT_SCENARIO_CLASSIC=chemin.png : étape 2 du scénario (isolation, coupe) ;
 *   SHOT_UNDERGROUND=chemin.png : vue souterraine (HTML-in-Canvas) sur le tronçon 13C1949 ;
 *   SHOT_NOAPI / SHOT_BAR_1440 / SHOT_BAR_1024=chemin.png : bandeau sans l'API, barre à 1440 et 1024 px.
 * Sortie : une ligne OK/ÉCHEC par point de contrôle ; code de sortie 1 si un échec.
 * Les tuiles viennent d'OpenFreeMap : chargements courts, une seule vue par page.
 */
import { stat } from "node:fs/promises";
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
  // le cas « sans fichier vidéo » du visiteur sans l'API simule un 404 (page.route) : erreur console attendue
  p.on("console", (m) => m.type() === "error" && !m.location().url.endsWith("/aqueduc/scenario-hic.webm") && errors.push(`console : ${m.text()}`));
  return errors;
}

/** Rectangles qui se recouvrent (px CSS). */
const overlaps = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** R19-3 : l'attribution est entière, lisible, non recouverte par la fiche, le récit ni la frise. */
async function attributionClear(p: Page, label: string) {
  const r = await p.evaluate(() => {
    const a = document.querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
    if (!a) return null;
    const box = a.getBoundingClientRect();
    const others = [...document.querySelectorAll<HTMLElement>(".aq-inspector, .aq-story, .aq-timeline, .aq-layers, .aq-noapi")].map((e) => ({ cls: e.className.split(" ")[0], r: e.getBoundingClientRect() }));
    // sur chaque lien de l'attribution, l'élément du dessus doit être l'attribution elle-même
    const covered = [...a.querySelectorAll("a")].filter((l) => {
      const q = l.getBoundingClientRect();
      const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return !top || !a.contains(top);
    }).length;
    return { text: a.textContent ?? "", box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, others: others.map((o) => ({ cls: o.cls, r: { left: o.r.left, right: o.r.right, top: o.r.top, bottom: o.r.bottom } })), covered, vw: innerWidth, vh: innerHeight };
  });
  if (!r) return check(`${label} : attribution présente`, false);
  const hit = r.others.filter((o) => overlaps(o.r, r.box)).map((o) => o.cls);
  check(`${label} : attribution complète (CC-BY 4.0, OpenFreeMap)`, /CC-BY 4\.0/.test(r.text) && /OpenFreeMap/.test(r.text), r.text.slice(0, 80));
  check(`${label} : attribution dans la fenêtre et non recouverte`, r.box.left >= 0 && r.box.right <= r.vw && r.box.bottom <= r.vh && hit.length === 0 && r.covered === 0, `recouvre ${hit.join(", ") || "rien"}, ${r.covered} lien(s) masqué(s)`);
}

/** R19-4 : tout ce que la barre contient tient dans la fenêtre, la recherche garde une largeur utile. */
async function barFits(p: Page, label: string, minSearch: number) {
  const r = await p.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".aq-app .aq-bar")!;
    const kids = [...bar.children].filter((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === "fixed").map((e) => ({ cls: (e as HTMLElement).className.toString().split(" ")[0], r: e.getBoundingClientRect() }));
    const search = document.querySelector<HTMLElement>(".aq-search input");
    return { vw: innerWidth, sw: document.documentElement.scrollWidth, barScroll: bar.scrollWidth, barClient: bar.clientWidth, out: kids.filter((k) => k.r.right > innerWidth + 0.5 || k.r.left < -0.5).map((k) => k.cls), search: search && search.offsetParent ? search.getBoundingClientRect().width : 0, h: bar.getBoundingClientRect().height };
  });
  check(`${label} : barre sans débordement`, r.out.length === 0 && r.barScroll <= r.barClient && r.sw === r.vw, `hors fenêtre : ${r.out.join(", ") || "rien"}, scrollWidth ${r.sw}/${r.vw}, barre ${r.barScroll}/${r.barClient}`);
  check(`${label} : recherche utilisable (≥ ${minSearch} px)`, r.search >= minSearch, `${Math.round(r.search)} px, barre ${Math.round(r.h)} px de haut`);
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
  if (js) {
    // fiche ouverte sur un téléphone : l'attribution (dépliée au départ) reste lisible
    await p.evaluate(() => (window as any).__aqueduc.store.setState({ selection: { kind: "segment", id: "13C1949" } }));
    await p.waitForTimeout(600);
    await attributionClear(p, "390 px, fiche ouverte");
    check("aucune erreur console", errors.length === 0, errors.join(" | "));
  }
  await ctx.close();
}

/** M3 : si la carte ne peut pas démarrer (ici, réseau en 500), le résumé du serveur reste visible. */
async function startupError(b: Browser) {
  console.log("\n== / carte indisponible : le résumé du serveur reste lisible");
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.route("**/api/aqueduc/network", (r) => r.fulfill({ status: 500, body: "" }));
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?mode=classic`);
  const alert = p.locator(".aq-fatal[role=alert]");
  await alert.waitFor({ timeout: 45_000 }).catch(() => {});
  const text = (await alert.count()) ? await alert.innerText() : "";
  check("alerte « Le réseau n'a pas pu être chargé »", /Le réseau n'a pas pu être chargé/.test(text), text);
  const r = await p.evaluate(() => ({
    ssr: !!document.querySelector(".aq-ssr")?.checkVisibility(),
    bar: !!document.querySelector(".aq-ssr-bar")?.checkVisibility(),
    app: document.querySelectorAll(".aq-app").length,
    flag: document.documentElement.dataset.aq ?? "",
  }));
  check("résumé et barre du serveur visibles, pas d'application qui les recouvre", r.ssr && r.bar && r.app === 0 && r.flag === "", JSON.stringify(r));
  await ctx.close();
}

/** I2 : `/` sans ?mode s'ouvre en HTML-in-Canvas quand l'API est présente (comme /carte et /mur). */
async function defaultMode(b: Browser) {
  console.log("\n== / sans ?mode, API présente");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/`);
  await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
  await p.waitForFunction(() => (window as any).__hicMap?.layer, null, { timeout: 15_000 }).catch(() => {});
  const st = await p.evaluate(() => {
    const s = (window as any).__aqueduc.store.getState();
    return { mode: s.mode, api: s.api, fallback: s.fallback, hic: !!(window as any).__hicMap?.layer, url: location.search };
  });
  check("/ sans ?mode : mode HTML-in-Canvas, API détectée", st.mode === "hic" && st.api !== "absente" && st.hic && st.fallback === "", JSON.stringify(st));
  check("bouton « HTML-in-Canvas » enfoncé", (await p.getByRole("button", { name: "HTML-in-Canvas", exact: true }).getAttribute("aria-pressed")) === "true");
  check("URL inchangée (pas de ?mode ajouté)", st.url === "", st.url);
  check("aucune erreur console (/ sans ?mode)", errors.length === 0, errors.join(" | "));
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
    await attributionClear(p, "fiche ouverte (classique)");
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

/** Vue souterraine (HTML-in-Canvas) : tubes 3D sous la rue, fond estompé, puis retour à la vue normale. */
async function undergroundHic(b: Browser) {
  console.log("\n== /?mode=hic, vue souterraine (tubes 3D)");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc?.tubes && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  await p.waitForFunction(() => (window as any).__aqueduc.store.getState().live.t > 0, null, { timeout: 15_000 });
  // caméra sur le tronçon du scénario
  await p.evaluate(async () => {
    const { map, net } = (window as any).__aqueduc;
    const c = net.data.segments.features[net.segById.get("13C1949")].geometry.coordinates;
    map.jumpTo({ center: c[Math.floor(c.length / 2)], zoom: 17.2, pitch: 62, bearing: -25 });
    await new Promise((r) => map.once("idle", r));
  });
  const state = () =>
    p.evaluate(() => {
      const { map, tubes, store } = (window as any).__aqueduc;
      return {
        layer: !!map.getLayer("aq-tubes"),
        instances: tubes.stats.instances as number,
        buildings: map.getPaintProperty("building-3d", "fill-extrusion-opacity"),
        pipes: map.getPaintProperty("aq-pipes", "line-opacity") ?? 1,
        casing: map.getLayoutProperty("aq-pipes-casing", "visibility") ?? "visible",
        note: document.querySelector(".aq-under-note")?.textContent ?? "",
        on: store.getState().underground as boolean,
      };
    });
  const drawn = (min: number) =>
    p
      .waitForFunction((min) => (window as any).__aqueduc.tubes.stats.instances > min, min, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
  const before = await state();
  check("vue normale : pas de couche de tubes, conduites en lignes au sol", !before.layer && before.instances === 0 && before.pipes === 1 && before.casing === "visible", JSON.stringify(before));
  await p.getByRole("button", { name: "Vue souterraine" }).click();
  const ok = await drawn(0);
  const on = await state();
  check("bouton « Vue souterraine » : couche aq-tubes présente, instances > 0", ok && on.on && on.layer && on.instances > 0, `${on.instances} instances`);
  check("mention « Diamètres exagérés ×12 » visible, dans le panneau des couches", on.note.includes("Diamètres exagérés ×12") && (await p.locator(".aq-layers .aq-under-note").isVisible()), on.note);
  check("bâtiments à 0,35, conduites au sol masquées", on.buildings === 0.35 && on.pipes === 0 && on.casing === "none", JSON.stringify(on));
  const order = await p.evaluate(() => {
    const ids: string[] = (window as any).__aqueduc.map.style._order;
    return { tubes: ids.indexOf("aq-tubes"), pipes: ids.indexOf("aq-pipes"), buildings: ids.indexOf("building-3d"), panels: ids.indexOf("hic-panels") };
  });
  check("ordre des couches : lignes < tubes < bâtiments < surfaces HTML", order.pipes < order.tubes && order.tubes < order.buildings && order.buildings < order.panels, JSON.stringify(order));
  const floating = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>(".aq-panel")].filter((e) => e.offsetParent !== null).map((e) => e.className));
  const extra = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>(".aq-stage > *")].filter((e) => e.offsetParent !== null && !e.matches(".aq-map, .aq-panel")).map((e) => e.className));
  check("rien d'autre ne flotte : couches et frise seulement", floating.length === 2 && floating.some((c) => c.includes("aq-layers")) && floating.some((c) => c.includes("aq-timeline")) && extra.length === 0, [...floating, ...extra].join(" | "));
  if (process.env.SHOT_UNDERGROUND) {
    await p.waitForTimeout(4000);
    await p.screenshot({ path: process.env.SHOT_UNDERGROUND });
    console.log(`capture : ${process.env.SHOT_UNDERGROUND}`);
  }
  await p.getByLabel("Tout le réseau").check();
  const all = await drawn(on.instances);
  const full = await state();
  check("« Tout le réseau » : plus d'instances que maîtresses + zone suivie", all && full.instances > on.instances, `${on.instances} → ${full.instances}`);
  await p.getByRole("button", { name: "Vue souterraine" }).click();
  await p.waitForTimeout(500);
  const off = await state();
  check("retour à la vue normale : tubes retirés, opacités et conduites rendues", !off.on && !off.layer && off.instances === 0 && off.buildings === 0.78 && off.pipes === 1 && off.casing === "visible" && off.note === "", JSON.stringify(off));
  const fallback = await p.evaluate(() => (window as any).__aqueduc.store.getState().fallback);
  check("pas de repli en mode classique", !fallback, fallback);
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Lance le scénario par la barre et passe à l'étape d'isolation ; renvoie l'heure simulée quittée. */
async function toIsolation(p: Page) {
  const before = await p.evaluate(() => {
    const st = (window as any).__aqueduc.store.getState();
    return { t0: st.clock.t0, startedAt: st.clock.startedAt, speed: st.clock.speed };
  });
  await p.getByRole("button", { name: "Lancer le scénario de bris" }).click();
  const story = p.locator("[data-testid=story]");
  await story.waitFor({ timeout: 5_000 }).catch(() => {});
  const text = (await story.count()) ? await story.innerText() : "";
  check("récit à gauche, étapes et mention « simulé »", /Détection/.test(text) && /Rapport/.test(text) && /simul/i.test(text), text.slice(0, 80).replace(/\n/g, " "));
  check("couches et recherche masquées pendant le scénario", (await p.locator(".aq-layers").count()) === 0 && !(await p.locator(".aq-search").isVisible()));
  await p.getByRole("button", { name: "Étape suivante →" }).click();
  // caméra de l'étape (1,5 s), puis tuiles et captures
  await p.waitForTimeout(1800);
  await p.evaluate(() => new Promise((r) => {
    const m = (window as any).__aqueduc.map;
    return m.loaded() && !m.isMoving() ? r(null) : m.once("idle", r);
  }));
  const st = await p.evaluate(() => (window as any).__aqueduc.store.getState());
  check("étape 2 : isolation, incident sans vannes fermées", st.scenario.step === "isolation" && st.incident && st.incident.closedValves.length === 0, JSON.stringify(st.scenario));
  return { left: before, resumeAt: st.scenario.resumeAt as number };
}

/** Retour au réseau vivant : récit et coupe démontés, horloge à l'heure quittée. */
async function leaveScenario(p: Page, resumeAt: number) {
  await p.getByRole("button", { name: "Explorer librement" }).click();
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const w = window as any;
    const st = w.__aqueduc.store.getState();
    return { active: st.scenario.active, t0: st.clock.t0, incident: st.incident, cut: w.__hicMap?.layer ? [...w.__hicMap.layer.panels.keys()].some((k: string) => k.startsWith("cut:")) : false };
  });
  check("« Explorer librement » : scénario vidé, incident retiré", !r.active && r.incident === null);
  check("horloge revenue à l'heure quittée", r.t0 === resumeAt, `${r.t0} / ${resumeAt}`);
  check("récit et coupe démontés, couches revenues", (await p.locator("[data-testid=story]").count()) === 0 && !r.cut && (await p.locator(".aq-layers").count()) === 1);
}

/** Scénario en mode HTML-in-Canvas : coupe sous la rue, vannes cliquées dans la scène, export vidéo. */
async function scenarioHic(b: Browser) {
  console.log("\n== /?mode=hic, scénario de bris (coupe sous la rue, vannes, vidéo)");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  await p.waitForFunction(() => (window as any).__aqueduc.store.getState().live.t > 0, null, { timeout: 15_000 });
  const { resumeAt } = await toIsolation(p);
  const cutOk = await p
    .waitForFunction(() => {
      const q = (window as any).__hicMap.layer.panels.get("cut:13C1949");
      return q && q.tex && q.proj && q.visible !== null;
    }, null, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  const r = await p.evaluate(() => {
    const w = window as any;
    const keys: string[] = [...w.__hicMap.layer.panels.keys()];
    const cut = document.querySelector('.maplibregl-canvas > [data-panel="cut:13C1949"]');
    const panels = [...document.querySelectorAll<HTMLElement>(".aq-panel")].filter((e) => e.offsetParent !== null).map((e) => e.className);
    return { keys, valves: cut ? [...cut.querySelectorAll("button.aq-valve")].map((e) => e.textContent) : [], panels, fallback: w.__aqueduc.store.getState().fallback };
  });
  check("coupe cut:13C1949 montée dans la scène, capturée", cutOk && r.keys.includes("cut:13C1949"), r.keys.join(" "));
  check("le marquage de l'incident laisse la place à la coupe", !r.keys.includes("incident:13C1949"));
  check("deux vannes, vrais boutons « V-xx · à fermer »", r.valves.length === 2 && r.valves.every((t) => /^V-\d+ · à fermer$/.test(t ?? "")), r.valves.join(" | "));
  check("rien d'autre ne flotte : récit et frise seulement", r.panels.length === 2 && r.panels.some((c) => c.includes("aq-story")) && r.panels.some((c) => c.includes("aq-timeline")), r.panels.join(" | "));
  check("pas de repli en mode classique", !r.fallback, r.fallback);
  await attributionClear(p, "récit (HTML-in-Canvas)");
  if (process.env.SHOT_SCENARIO_HIC) {
    await p.waitForTimeout(3000);
    await p.screenshot({ path: process.env.SHOT_SCENARIO_HIC });
    console.log(`capture : ${process.env.SHOT_SCENARIO_HIC}`);
  }

  // clic sur chaque vanne là où elle est dessinée dans la scène (hit testing avec occlusion)
  const valveAt = (i: number) =>
    p.evaluate((i) => {
      const w = window as any;
      const q = w.__hicMap.layer.panels.get("cut:13C1949");
      const el = q.el.querySelectorAll("button.aq-valve")[i] as HTMLElement;
      const box = w.__aqueduc.map.getCanvas().getBoundingClientRect();
      const [x, y] = q.proj.project(el.offsetLeft, el.offsetTop + el.offsetHeight / 2);
      return { x: box.left + x, y: box.top + y };
    }, i);
  for (const i of [0, 1]) {
    const pt = await valveAt(i);
    await p.mouse.move(pt.x, pt.y);
    await p.waitForTimeout(800);
    await p.mouse.click(pt.x, pt.y);
    await p.waitForTimeout(400);
  }
  const closed = await p
    .waitForFunction(() => (window as any).__aqueduc.store.getState().scenario.valvesClosed, null, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  const st = await p.evaluate(() => (window as any).__aqueduc.store.getState());
  check("clic sur les deux vannes dans la coupe → closeValvesAction, vannes fermées", closed && st.incident?.closedValves.length === 2, JSON.stringify(st.scenario));
  const insp = p.locator("[data-testid=inspector]");
  const dry = await p
    .waitForFunction(() => /Vannes fermées/.test(document.querySelector("[data-testid=inspector]")?.textContent ?? "") && /adresses sans eau/.test(document.querySelector("[data-testid=inspector]")?.textContent ?? ""), null, { timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  const itext = (await insp.count()) ? await insp.innerText() : "";
  check("fiche « Vannes fermées », secteurs touchés recalculés (adresses sans eau)", dry, itext.replace(/\n/g, " ").slice(0, 160));
  const fig = await p.locator(".aq-story-fig").innerText().catch(() => "");
  check("récit : « Y adresses sans eau » après l'isolation", /\d+ adresses? sans eau/.test(fig), fig);
  const cutText = await p.locator('.maplibregl-canvas > [data-panel="cut:13C1949"]').innerText().catch(() => "");
  check("coupe : vannes fermées, tronçon à 0 bar", /fermée/.test(cutText) && !/à fermer/.test(cutText));

  // rapport : export vidéo de la séquence (10 s)
  for (let i = 0; i < 3; i++) await p.getByRole("button", { name: "Étape suivante →" }).click();
  const report = await p.locator(".aq-story-fig").innerText().catch(() => "");
  check("rapport : chronologie et adresses touchées", /basse pression/.test(report) && /sans eau pendant/.test(report), report);
  const t = Date.now();
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 40_000 }), p.getByRole("button", { name: "Exporter la vidéo" }).click()]);
  const file = await dl.path();
  const size = file ? (await stat(file)).size : 0;
  check("export vidéo : scenario-bris.webm téléchargé", dl.suggestedFilename() === "scenario-bris.webm" && size > 20_000, `${dl.suggestedFilename()}, ${size} octets, ${Date.now() - t} ms`);
  const done = await p
    .waitForFunction(() => /Vidéo enregistrée/.test(document.querySelector(".aq-story-export .aq-note")?.textContent ?? ""), null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  check("message de fin d'enregistrement", done, await p.locator(".aq-story-export .aq-note").innerText());
  await leaveScenario(p, resumeAt);
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Scénario en mode classique : la coupe est une illustration 2D dans la fiche, avec les mêmes vannes. */
async function scenarioClassic(b: Browser) {
  console.log("\n== /?mode=classic, scénario de bris (coupe dans la fiche)");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/?mode=classic`);
  await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
  await p.waitForFunction(() => (window as any).__aqueduc.store.getState().live.t > 0, null, { timeout: 15_000 });
  const { resumeAt } = await toIsolation(p);
  const insp = p.locator("[data-testid=inspector]");
  await insp.waitFor({ timeout: 5_000 }).catch(() => {});
  const text = (await insp.count()) ? await insp.innerText() : "";
  const valves = p.locator("[data-testid=inspector] .aq-cut-card button");
  check("fiche de l'incident ouverte d'office, coupe 2D et « Vannes à fermer »", /Vannes à fermer/.test(text) && (await p.locator(".aq-cut-card svg").count()) === 1, text.replace(/\n/g, " ").slice(0, 120));
  check("deux vannes, vrais boutons « V-xx · à fermer »", (await valves.count()) === 2 && (await valves.allInnerTexts()).every((t) => /^V-\d+ · à fermer$/.test(t)));
  await attributionClear(p, "fiche de l'incident (classique)");
  if (process.env.SHOT_SCENARIO_CLASSIC) {
    await p.waitForTimeout(2500);
    await p.screenshot({ path: process.env.SHOT_SCENARIO_CLASSIC });
    console.log(`capture : ${process.env.SHOT_SCENARIO_CLASSIC}`);
  }
  await valves.nth(0).click();
  await valves.nth(1).click();
  const dry = await p
    .waitForFunction(() => /Vannes fermées/.test(document.querySelector("[data-testid=inspector]")?.textContent ?? "") && /adresses sans eau/.test(document.querySelector("[data-testid=inspector]")?.textContent ?? ""), null, { timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  check("vannes fermées depuis la fiche → « Vannes fermées », adresses sans eau", dry, ((await insp.count()) ? await insp.innerText() : "").replace(/\n/g, " ").slice(0, 160));
  await leaveScenario(p, resumeAt);
  check("fiche de l'incident refermée", (await insp.count()) === 0);
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** R19-4 : la barre d'application à plusieurs largeurs (le bouton du scénario est dans la barre). */
async function appBar(b: Browser) {
  console.log("\n== barre d'application, plusieurs largeurs");
  for (const [w, minSearch] of [[1440, 240], [1280, 200], [1024, 140], [768, 140], [390, 200]] as const) {
    const ctx = await b.newContext({ viewport: { width: w, height: 860 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/?mode=classic`);
    await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
    await p.waitForTimeout(600);
    await barFits(p, `${w} px`, minSearch);
    const launch = await p.locator(".aq-launch").isVisible();
    check(`${w} px : bouton du scénario visible`, launch);
    if (w === 1440 && process.env.SHOT_BAR_1440) await p.screenshot({ path: process.env.SHOT_BAR_1440, clip: { x: 0, y: 0, width: w, height: 120 } });
    if (w === 1024 && process.env.SHOT_BAR_1024) await p.screenshot({ path: process.env.SHOT_BAR_1024, clip: { x: 0, y: 0, width: w, height: 120 } });
    await ctx.close();
  }
}

/**
 * Visiteur sans l'API (Chromium lancé sans CanvasDrawElement) : mode classique, bandeau, vidéo
 * seulement si le fichier répond 200 (publié : public/aqueduc/scenario-hic.webm ; absence simulée par un 404),
 * explication « Comment l'activer », fermeture retenue pour la session.
 */
async function withoutApi() {
  console.log("\n== / sans l'API HTML-in-Canvas");
  const nb = await chromium.launch({ args: ["--disable-blink-features=CanvasDrawElement"] });
  try {
    const open = async (video: boolean, path = "/", width = 1440) => {
      const ctx = await nb.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 1 });
      // le fichier est publié (tâche 12) : son absence est simulée par un 404, sa présence par un vrai 200
      if (!video) await ctx.route("**/aqueduc/scenario-hic.webm", (r) => r.fulfill({ status: 404, body: "" }));
      const p = await ctx.newPage();
      const errors = collectErrors(p);
      await p.goto(`${BASE}${path}`);
      await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
      return { ctx, p, errors };
    };
    const banner = (p: Page) => p.locator("[data-testid=noapi]");

    // 1) sans fichier vidéo : bandeau, pas de bouton vidéo
    let { ctx, p, errors } = await open(false);
    const st = await p.evaluate(() => {
      const s = (window as any).__aqueduc.store.getState();
      return { mode: s.mode, api: s.api, hic: (window as any).__hicMap?.layer ?? null };
    });
    check("sans l'API : mode classique, API absente", st.mode === "classic" && st.api === "absente" && st.hic === null, `${st.mode} / ${st.api}`);
    await banner(p).waitFor({ timeout: 5_000 }).catch(() => {});
    const text = (await banner(p).count()) ? await banner(p).innerText() : "";
    check("bandeau « Votre navigateur n'active pas HTML-in-Canvas : vous voyez la version classique. »", text.includes("Votre navigateur n'active pas HTML-in-Canvas : vous voyez la version classique."), text.slice(0, 90));
    await p.waitForTimeout(800);
    check("sans fichier vidéo : pas de bouton vidéo (Review Focus 1)", (await p.getByRole("button", { name: "Voir la version HTML-in-Canvas en vidéo" }).count()) === 0);
    // « Comment l'activer » : le drapeau, puis relancer Chrome, et le jeton d'essai
    await p.getByRole("button", { name: "Comment l'activer" }).click();
    const how = await p.locator("#aq-noapi-how").innerText().catch(() => "");
    check("« Comment l'activer » : chrome://flags/#canvas-draw-element, relancer Chrome, jeton d'essai", how.includes("chrome://flags/#canvas-draw-element") && /relancez Chrome/.test(how) && /jeton d'essai/.test(how), how);
    // le bandeau ne recouvre ni les commandes ni l'attribution, et la carte reste complète
    const geo = await p.evaluate(() => {
      const b = document.querySelector("[data-testid=noapi]")!.getBoundingClientRect();
      const st = document.querySelector(".aq-stage")!.getBoundingClientRect();
      const bar = document.querySelector(".aq-app .aq-bar")!.getBoundingClientRect();
      const hit = [".maplibregl-ctrl-attrib", ".aq-layers", ".aq-timeline"].filter((q) => {
        const e = document.querySelector(q)?.getBoundingClientRect();
        return e && e.top < b.bottom && e.bottom > b.top;
      });
      return { bannerH: b.height, below: b.top >= bar.bottom - 0.5 && b.bottom <= st.top + 0.5, hit, sw: document.documentElement.scrollWidth, vw: innerWidth };
    });
    check("bandeau compact, sous la barre, sans recouvrir les commandes de la carte", geo.below && geo.hit.length === 0 && geo.bannerH <= 80, `${Math.round(geo.bannerH)} px, recouvre ${geo.hit.join(", ") || "rien"}`);
    await attributionClear(p, "bandeau ouvert");
    if (process.env.SHOT_NOAPI) {
      await p.waitForTimeout(2500);
      await p.screenshot({ path: process.env.SHOT_NOAPI });
      console.log(`capture : ${process.env.SHOT_NOAPI}`);
    }
    // fermeture mémorisée pour la session (même onglet : rechargement)
    await p.getByRole("button", { name: "Fermer le bandeau" }).click();
    check("bandeau fermé", (await banner(p).count()) === 0);
    await p.reload();
    await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
    await p.waitForTimeout(800);
    check("fermeture retenue pour la session (après rechargement)", (await banner(p).count()) === 0);
    check("aucune erreur console (sans l'API)", errors.length === 0, errors.join(" | "));
    await ctx.close();

    // 2) avec un fichier qui répond 200 : le bouton ouvre la vidéo
    ({ ctx, p, errors } = await open(true));
    const btn = p.getByRole("button", { name: "Voir la version HTML-in-Canvas en vidéo" });
    await btn.waitFor({ timeout: 8_000 }).catch(() => {});
    check("avec le fichier (200) : bouton vidéo présent", (await btn.count()) === 1);
    if (await btn.count()) {
      await btn.click();
      const v = p.locator("video[controls]");
      await v.waitFor({ timeout: 5_000 }).catch(() => {});
      const src = (await v.count()) ? await v.getAttribute("src") : "";
      check("le bouton ouvre un <video controls> sur scenario-hic.webm", /\/aqueduc\/scenario-hic\.webm$/.test(src ?? ""), String(src));
      const dlg = await p.evaluate(() => {
        const d = document.querySelector<HTMLDialogElement>("dialog.aq-noapi-video");
        return { open: !!d?.open, modal: !!d?.matches(":modal"), focusIn: !!d?.contains(document.activeElement), caption: d?.querySelector(".aq-noapi-credits")?.textContent ?? "" };
      });
      check("vidéo dans un <dialog> modal natif, focus à l'intérieur", dlg.open && dlg.modal && dlg.focusIn, JSON.stringify(dlg));
      check("légende de la vidéo : conduites, fond de carte, simulation", /Ville de Trois-Rivières, Données Québec, CC-BY 4\.0/.test(dlg.caption) && /OpenFreeMap, OpenMapTiles, OpenStreetMap/.test(dlg.caption) && /simulation/.test(dlg.caption), dlg.caption);
      // Tab ne sort pas du dialogue (le navigateur rend la page inerte)
      for (let i = 0; i < 4; i++) await p.keyboard.press("Tab");
      check("Tab reste dans le dialogue", await p.evaluate(() => !!document.querySelector("dialog.aq-noapi-video")?.contains(document.activeElement)));
      await p.keyboard.press("Escape");
      check("Échap referme la vidéo", (await p.locator("video[controls]").count()) === 0);
      check("le focus revient au bouton d'ouverture", await p.evaluate(() => document.activeElement?.textContent === "Voir la version HTML-in-Canvas en vidéo"));
    }
    await ctx.close();

    // 3) ?mode=hic sans l'API : repli expliqué
    ({ ctx, p, errors } = await open(false, "/?mode=hic"));
    const fb = await p.evaluate(() => { const s = (window as any).__aqueduc.store.getState(); return { mode: s.mode, fallback: s.fallback }; });
    check("/?mode=hic sans l'API : repli classique expliqué", fb.mode === "classic" && /API HTML-in-Canvas absente/.test(fb.fallback), fb.fallback);
    check("bouton « HTML-in-Canvas » désactivé", await p.getByRole("button", { name: "HTML-in-Canvas", exact: true }).isDisabled());
    await ctx.close();

    // 4) mobile : aucun défilement horizontal avec le bandeau
    ({ ctx, p, errors } = await open(false, "/", 390));
    await banner(p).waitFor({ timeout: 5_000 }).catch(() => {});
    await p.getByRole("button", { name: "Comment l'activer" }).click();
    const sw = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, h: document.querySelector("[data-testid=noapi]")?.getBoundingClientRect().height ?? 0 }));
    check("390 px avec le bandeau : aucun défilement horizontal", sw.sw === 390, `scrollWidth ${sw.sw}, bandeau ${Math.round(sw.h)} px`);
    await ctx.close();
  } finally {
    await nb.close();
  }
}

/** Repli après vérification (API présente) : la raison est affichée dans une note refermable. */
async function fallbackNote(b: Browser) {
  console.log("\n== / repli HTML-in-Canvas après vérification : note visible");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  check("API présente : pas de bandeau avant le repli", (await p.locator("[data-testid=noapi]").count()) === 0);
  // même écriture que `onFallback` de la scène (texture vide, aucun paint…)
  await p.evaluate(() => (window as any).__aqueduc.store.setState({ mode: "classic", fallback: "Mode classique activé automatiquement : texture vide (test)." }));
  const note = p.locator("[data-testid=noapi-lost]");
  await note.waitFor({ timeout: 5_000 }).catch(() => {});
  const text = (await note.count()) ? await note.innerText() : "";
  check("note de repli visible : raison et mode classique", /s'est désactivé pendant l'affichage/.test(text) && text.includes("texture vide (test)"), text.slice(0, 140));
  check("note de repli : pas de « Comment l'activer » (l'API est présente)", (await p.getByRole("button", { name: "Comment l'activer" }).count()) === 0);
  // M5 : un retour manuel à HTML-in-Canvas efface la raison ; revenir ensuite en classique ne la ressort pas
  await p.getByRole("button", { name: "HTML-in-Canvas", exact: true }).click();
  await p.waitForTimeout(500);
  const back = await p.evaluate(() => { const s = (window as any).__aqueduc.store.getState(); return { mode: s.mode, fallback: s.fallback }; });
  check("retour manuel à HTML-in-Canvas : raison du repli effacée", back.mode === "hic" && back.fallback === "", JSON.stringify(back));
  await p.getByRole("button", { name: "Classique", exact: true }).click();
  await p.waitForTimeout(500);
  check("puis Classique : pas de note périmée « s'est désactivé pendant l'affichage »", (await p.locator("[data-testid=noapi]").count()) === 0);
  await p.evaluate(() => (window as any).__aqueduc.store.setState({ mode: "classic", fallback: "Mode classique activé automatiquement : texture vide (test)." }));
  await note.waitFor({ timeout: 5_000 }).catch(() => {});
  await p.getByRole("button", { name: "Fermer le bandeau" }).click();
  check("note refermable", (await p.locator("[data-testid=noapi]").count()) === 0);
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
    return { mode: st.mode, fallback: st.fallback || stats.fallback || "", api: st.api, uploads: stats.uploads, verified: stats.verified, panels: w.__hicMap?.layer?.panels.size };
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
  await defaultMode(b);
  await startupError(b);
  await undergroundHic(b);
  await scenarioHic(b);
  await scenarioClassic(b);
  await appBar(b);
  await withoutApi();
  await fallbackNote(b);
  await carteHic(b);
  await otherPages();
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert.");
process.exit(failures ? 1 : 0);
