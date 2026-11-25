/**
 * Vérification rapide de bout en bout (Chromium de Playwright, serveur sur BASE_URL).
 *   BASE_URL=http://localhost:3300 npx tsx tests/e2e/smoke.ts
 *   SHOT=chemin.png pour enregistrer une capture de la page d'accueil (mode classique, 1440 × 860) ;
 *   SHOT_HIC=chemin.png pour la même vue en mode HTML-in-Canvas ;
 *   SHOT_SCENARIO_HIC / SHOT_SCENARIO_CLASSIC=chemin.png : étape 2 du scénario (isolation, coupe) ;
 *   SHOT_UNDERGROUND=chemin.png : vue souterraine (HTML-in-Canvas) sur le tronçon 13C1949 ;
 *   SHOT_NOAPI / SHOT_BAR_1440 / SHOT_BAR_1024=chemin.png : bandeau sans l'API, barre à 1440 et 1024 px ;
 *   SHOT_SWITCHER=chemin.png : sélecteur d'environnement ouvert (HTML-in-Canvas) ;
 *   SHOT_HOME / SHOT_BELL / SHOT_ABOUT=chemin.png : accueil à 14:05, cloche ouverte, « À propos » ;
 *   SHOT_DN_1030 / SHOT_DN_2330 / SHOT_DN_2330_LOW / SHOT_DN_CARD=chemin.png : Déneigement
 *   (HTML-in-Canvas) à 10:30, à 23:30 avec les zones A et B en vigueur (feux allumés en phase haute,
 *   puis basse du clignotement), puis la fiche de la zone A ;
 *   SHOT_DN_METEO_OFF / SHOT_DN_SNOW=chemin.png : Déneigement (classique) à 23:30, météo en panne,
 *   puis jour de neige réel avec avertissement.
 * Chaque page de l'application a son horloge épinglée à 12:00 de la journée de référence
 * (`pin`) : les vérifications ne dépendent pas de l'heure du lancement.
 * Sortie : une ligne OK/ÉCHEC par point de contrôle ; code de sortie 1 si un échec.
 * Les tuiles viennent d'OpenFreeMap : chargements courts, une seule vue par page.
 */
import { readFile, stat } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import { SCENARIO_DAY } from "../../src/lib/aqueduc/scenario";
import { atHour } from "../../src/lib/territoire/day";
import { parseCityPage } from "../../src/lib/territoire/meteo";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
/** Vue 3D de l'aqueduc (la scène persistante de `/carte`). */
const AQ = "/carte/aqueduc";
/** Heure épinglée : 12:00 de la journée de référence, avant le bris de 14:00. */
const NOON = atHour(SCENARIO_DAY, "12:00");
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
  // la panne de la météo (Déneigement, ruling P2) simule un 500 sur /api/territoire/meteo : erreur console attendue
  p.on("console", (m) => m.type() === "error" && !m.location().url.endsWith("/territoire/visite-hic.webm") && !m.location().url.endsWith("/api/territoire/meteo") && errors.push(`console : ${m.text()}`));
  return errors;
}

/**
 * Épingle l'horloge commune à `at` (×1) par `window.__territoire.store`, puis attend une lecture du
 * flux à cette heure : les vérifications ne dépendent plus de l'heure réelle.
 */
async function pin(p: Page, at = NOON) {
  await p.waitForFunction(() => (window as any).__territoire?.store, null, { timeout: 45_000 });
  await p.evaluate((t) => (window as any).__territoire.store.setState({ clock: { t0: t, speed: 1, startedAt: Date.now() } }), at);
  await p
    .waitForFunction((t) => {
      const lt = (window as any).__aqueduc?.store.getState().live.t ?? 0;
      return lt >= t && lt < t + 3_600_000;
    }, at, { timeout: 15_000 })
    .catch(() => {});
}

/** Heure locale « HH:MM » (America/Toronto) de l'instant t. */
const localTime = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);

/** Rectangles qui se recouvrent (px CSS). */
const overlaps = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** R19-3 : l'attribution est entière, lisible, non recouverte par la fiche, le récit ni la frise. */
async function attributionClear(p: Page, label: string) {
  const r = await p.evaluate(() => {
    const a = document.querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
    if (!a) return null;
    const box = a.getBoundingClientRect();
    const others = [...document.querySelectorAll<HTMLElement>(".aq-inspector, .aq-story, .aq-timeline, .aq-layers, .aq-noapi, .tr-switcher")].map((e) => ({ cls: e.className.split(" ")[0], r: e.getBoundingClientRect() }));
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
  console.log(`\n== ${AQ} sans JavaScript`);
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const res = await p.goto(`${BASE}${AQ}`);
  check("statut 200", res?.status() === 200, String(res?.status()));
  const text = await p.locator("body").innerText();
  check("« Ville de Trois-Rivières » (attribution)", text.includes("Ville de Trois-Rivières"));
  check("« Simulation »", text.includes("Simulation"));
  check("titre de la page", (await p.title()).includes("Aqueduc"), await p.title());
  check("titre et résumé : « Réseau d'eau potable de Trois-Rivières »", (await p.locator("h1").innerText()).includes("Réseau d'eau potable"));
  check("secteurs listés avec statut", (await p.locator(".aq-table tbody tr").count()) === 10);
  check("liens ordinaires : Déneigement et « À propos »", (await p.locator('nav a[href="/carte/deneigement"]').count()) === 1 && (await p.locator('nav a[href="/a-propos"]').count()) === 1);
  const dn = await p.goto(`${BASE}/carte/deneigement`);
  const dnText = await p.locator("body").innerText();
  check("/carte/deneigement sans JavaScript : 200, titre et résumé", dn?.status() === 200 && (await p.locator("h1").innerText()).includes("Déneigement") && /Zones de stationnement de nuit/.test(dnText), String(dn?.status()));
  await ctx.close();
}

/** Routes : `/` est l'accueil (?mode transmis aux liens des vues 3D), un environnement inconnu répond 404, un environnement du lot 2 renvoie à `/`. */
async function routes() {
  console.log("\n== routes");
  const root = await fetch(`${BASE}/?mode=hic`, { redirect: "manual" });
  const html = await root.text();
  check("/ → 200 (accueil), ?mode=hic transmis aux liens des vues 3D", root.status === 200 && html.includes('href="/carte/aqueduc?mode=hic"') && html.includes('href="/carte/deneigement?mode=hic"'), String(root.status));
  const unknown = await fetch(`${BASE}/carte/inconnu`, { redirect: "manual" });
  check("/carte/inconnu → 404", unknown.status === 404, String(unknown.status));
  const soon = await fetch(`${BASE}/carte/collecte`, { redirect: "manual" });
  check("/carte/collecte (lot 2, « À venir ») → redirection vers /", soon.status === 307 && soon.headers.get("location") === "/", `${soon.status} ${soon.headers.get("location")}`);
}

async function narrow(b: Browser, js: boolean) {
  console.log(`\n== 390 px ${js ? "avec" : "sans"} JavaScript`);
  const ctx = await b.newContext({ javaScriptEnabled: js, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}`);
  if (js) {
    await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 30_000 });
    await pin(p);
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
  console.log(`\n== ${AQ} carte indisponible : le résumé du serveur reste lisible`);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.route("**/api/aqueduc/network", (r) => r.fulfill({ status: 500, body: "" }));
  const p = await ctx.newPage();
  await p.goto(`${BASE}${AQ}?mode=classic`);
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

/** I2 : `/` sans ?mode s'ouvre en HTML-in-Canvas quand l'API est présente */
async function defaultMode(b: Browser) {
  console.log(`\n== ${AQ} sans ?mode, API présente`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}`);
  await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
  await pin(p);
  await p.waitForFunction(() => (window as any).__hicMap?.layer, null, { timeout: 15_000 }).catch(() => {});
  const st = await p.evaluate(() => {
    const s = (window as any).__aqueduc.territoire.getState();
    return { mode: s.mode, api: s.api, fallback: s.fallback, hic: !!(window as any).__hicMap?.layer, url: location.search };
  });
  check(`${AQ} sans ?mode : mode HTML-in-Canvas, API détectée`, st.mode === "hic" && st.api !== "absente" && st.hic && st.fallback === "", JSON.stringify(st));
  check("bouton « HTML-in-Canvas » enfoncé", (await p.getByRole("button", { name: "HTML-in-Canvas", exact: true }).getAttribute("aria-pressed")) === "true");
  check("URL inchangée (pas de ?mode ajouté)", st.url === "", st.url);
  check("aucune erreur console (/ sans ?mode)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** État de la scène persistante : identité de la carte et du canvas, couches et surfaces de l'aqueduc. */
async function sceneState(p: Page) {
  return p.evaluate(() => {
    const w = window as any;
    const map = w.__territoire.map;
    const canvas = map.getCanvas() as HTMLCanvasElement;
    const style = map.getStyle();
    return {
      env: w.__territoire.env as string | null,
      sameMap: map === w.__mapRef,
      id: map.__id as number,
      sameCanvas: canvas === w.__canvasRef,
      canvases: document.querySelectorAll(".aq-map canvas").length,
      aqLayers: style.layers.filter((l: { id: string }) => l.id.startsWith("aq-")).map((l: { id: string }) => l.id) as string[],
      aqSources: Object.keys(style.sources).filter((k) => k.startsWith("aq-")),
      pipes: !!map.getLayer("aq-pipes"),
      hicLayer: !!map.getLayer("hic-panels"),
      surfaces: canvas.querySelectorAll("[data-panel]").length,
      layoutsubtree: canvas.hasAttribute("layoutsubtree"),
      markers: document.querySelectorAll(".maplibregl-marker").length,
      aqueducApi: !!w.__aqueduc,
      noReload: w.__noReload === true,
      streams: w.__openStreams ? w.__openStreams.size : -1,
      hicGlobal: !!w.__hicMap,
      attribution: document.querySelector(".maplibregl-ctrl-attrib")?.textContent ?? "",
      panelKeys: [...canvas.querySelectorAll<HTMLElement>("[data-panel]")].map((e) => e.dataset.panel ?? "").sort(),
      dnLayers: style.layers.filter((l: { id: string }) => l.id.startsWith("dn-")).map((l: { id: string }) => l.id) as string[],
      dnSources: Object.keys(style.sources).filter((k) => k.startsWith("dn-")),
      snowApi: !!w.__territoire.snow,
    };
  });
}

/**
 * Scène persistante : passer de l'aqueduc au déneigement par le sélecteur (clic) change l'URL sans
 * recharger la page, garde la même carte et le même canvas, et démonte l'aqueduc sans fuite ; le
 * retour remonte ses couches et ses surfaces.
 */
async function envSwitch(b: Browser) {
  console.log(`\n== ${AQ}?mode=hic → Déneigement → Aqueduc (sélecteur, scène persistante)`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  // flux SSE ouverts (window.__openStreams) : le démontage de l'aqueduc doit les fermer
  await ctx.addInitScript(`{
    const ES = window.EventSource;
    const open = new Set();
    window.__openStreams = open;
    window.EventSource = class extends ES {
      constructor(u, o) { super(u, o); open.add(this); }
      close() { open.delete(this); super.close(); }
    };
  }`);
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  await pin(p);
  const active = await p
    .waitForFunction(() => (window as any).__territoire.store.getState().api === "active", null, { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  const st0 = await p.evaluate(() => {
    const w = window as any;
    w.__mapRef = w.__territoire.map;
    w.__canvasRef = w.__territoire.map.getCanvas();
    w.__noReload = true;
    const s = w.__territoire.store.getState();
    return { mode: s.mode, api: s.api, env: w.__territoire.env };
  });
  check("/carte/aqueduc?mode=hic : mode HTML-in-Canvas, API active, environnement « aqueduc »", active && st0.mode === "hic" && st0.api === "active" && st0.env === "aqueduc", JSON.stringify(st0));
  const before = await sceneState(p);
  check("aqueduc monté : couches aq-pipes et surfaces dans le canvas", before.pipes && before.hicLayer && before.surfaces > 0 && before.aqueducApi, `${before.aqLayers.length} couches, ${before.surfaces} surfaces`);

  // sélecteur : fenêtre des 5 environnements, lot 2 « À venir » et inactif ; clavier
  const opener = p.locator(".tr-switcher-btn");
  await opener.click();
  const dlg = p.getByRole("dialog", { name: "Changer d'environnement" });
  await dlg.waitFor({ timeout: 5_000 }).catch(() => {});
  const items = await dlg.locator(".tr-env").evaluateAll((els) => els.map((e) => ({ t: e.querySelector("b")?.textContent ?? "", off: e.getAttribute("aria-disabled") === "true", soon: e.textContent?.includes("À venir") ?? false, cur: e.getAttribute("aria-current") })));
  check(
    "sélecteur : 5 environnements, Aqueduc courant, Collecte, Zonage et Évaluation « À venir » et inactifs",
    items.length === 5 && items[0].cur === "page" && items.filter((i) => i.off && i.soon).length === 3 && !items[1].off,
    JSON.stringify(items),
  );
  if (process.env.SHOT_SWITCHER) {
    await p.waitForTimeout(2500);
    await p.screenshot({ path: process.env.SHOT_SWITCHER });
    console.log(`capture : ${process.env.SHOT_SWITCHER}`);
  }
  check("focus sur l'environnement courant à l'ouverture", await p.evaluate(() => document.activeElement?.getAttribute("aria-current") === "page"));
  await p.keyboard.press("ArrowDown");
  check("flèche bas : focus sur Déneigement", (await p.evaluate(() => document.activeElement?.querySelector("b")?.textContent)) === "Déneigement");
  await p.keyboard.press("Escape");
  check("Échap : fenêtre refermée, focus rendu au bouton", (await dlg.count()) === 0 && (await p.evaluate(() => !!document.activeElement?.classList.contains("tr-switcher-btn"))));
  // un environnement « À venir » ne mène nulle part
  await opener.click();
  await dlg.getByRole("button", { name: /Collecte/ }).click({ force: true });
  check("clic sur « Collecte » (À venir) : l'URL ne change pas", new URL(p.url()).pathname === AQ, p.url());

  // vers le déneigement, au clic
  if ((await dlg.count()) === 0) await opener.click();
  await dlg.getByRole("button", { name: /Déneigement/ }).click();
  const moved = await p.waitForURL("**/carte/deneigement**", { timeout: 10_000 }).then(() => true).catch(() => false);
  await p.waitForFunction(() => (window as any).__territoire.env === "deneigement", null, { timeout: 10_000 }).catch(() => {});
  const panel = p.locator(".tr-envpanel h2", { hasText: "Déneigement" });
  await panel.waitFor({ timeout: 10_000 }).catch(() => {});
  const after = await sceneState(p);
  check("URL /carte/deneigement, sans rechargement de la page", moved && after.noReload && new URL(p.url()).pathname === "/carte/deneigement", p.url());
  check("même carte (même objet, même __id) et même canvas", after.sameMap && after.id === before.id && after.sameCanvas && after.canvases === 1, `__id ${before.id} → ${after.id}, ${after.canvases} canvas`);
  check("couches de l'aqueduc retirées (aq-pipes absente, aucune couche ni source aq-*)", !after.pipes && after.aqLayers.length === 0 && after.aqSources.length === 0, `${after.aqLayers.join(" ")} ${after.aqSources.join(" ")}`);
  check("surfaces de l'aqueduc démontées, API de l'aqueduc retirée ; seuls les marquages des zones A, B, C dans le canvas", after.panelKeys.join(" ") === "zone:A zone:B zone:C" && after.markers === 0 && !after.aqueducApi, JSON.stringify({ keys: after.panelKeys, markers: after.markers, api: after.aqueducApi }));
  check("déneigement monté : couches dn-zone-fill, dn-zone-line, dn-lights, pilotage __territoire.snow", ["dn-zone-fill", "dn-zone-line", "dn-lights"].every((id) => after.dnLayers.includes(id)) && after.dnSources.length === 2 && after.snowApi, `${after.dnLayers.join(" ")} · ${after.dnSources.join(" ")}`);
  check("flux des capteurs fermé (aucun EventSource ouvert)", before.streams === 1 && after.streams === 0, `${before.streams} → ${after.streams}`);
  check("panneau « Déneigement », barre à jour", (await panel.count()) === 1 && (await p.locator(".tr-crumb").innerText()).includes("Déneigement"));
  check("attribution du déneigement (zones), plus celle des conduites", /Zones de stationnement de nuit/.test(after.attribution) && !/Conduites/.test(after.attribution) && /OpenFreeMap/.test(after.attribution), after.attribution.slice(0, 120));
  const cam = await p.evaluate(() => (window as any).__territoire.map.getZoom());
  check("caméra au cadrage du déneigement (vue large)", cam < 13, `zoom ${cam.toFixed(2)}`);

  // retour à l'aqueduc
  await opener.click();
  await dlg.getByRole("button", { name: /Aqueduc/ }).click();
  await p.waitForURL(`**${AQ}**`, { timeout: 10_000 }).catch(() => {});
  await p.waitForFunction(() => (window as any).__aqueduc && (window as any).__territoire.map.getLayer("aq-pipes"), null, { timeout: 20_000 }).catch(() => {});
  const back = await p
    .waitForFunction(() => {
      const L = (window as any).__hicMap?.layer;
      return L && [...L.panels.keys()].some((k: string) => k.startsWith("sector:"));
    }, null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  const again = await sceneState(p);
  check("retour à l'aqueduc : mêmes carte et canvas, couches, surfaces et flux revenus", again.sameMap && again.sameCanvas && again.pipes && again.hicLayer && back && again.aqueducApi && again.noReload && again.streams === 1, JSON.stringify({ pipes: again.pipes, hic: again.hicLayer, surfaces: again.surfaces, streams: again.streams }));
  check("déneigement démonté sans fuite : aucune couche ni source dn-*, aucun marquage zone:*, __territoire.snow retiré", again.dnLayers.length === 0 && again.dnSources.length === 0 && !again.panelKeys.some((k) => k.startsWith("zone:")) && !again.snowApi, JSON.stringify({ layers: again.dnLayers, sources: again.dnSources, keys: again.panelKeys.filter((k) => k.startsWith("zone:")), snow: again.snowApi }));

  // recherche depuis un autre environnement : le résultat y ramène et ouvre sa fiche (focus)
  await opener.click();
  await dlg.getByRole("button", { name: /Déneigement/ }).click();
  await p.waitForURL("**/carte/deneigement**", { timeout: 10_000 }).catch(() => {});
  await p.locator(".tr-envpanel h2", { hasText: "Déneigement" }).waitFor({ timeout: 10_000 }).catch(() => {});
  await p.locator(".aq-search input").fill("P-01");
  const option = await p.locator(".tr-search-list [role=option]").first().innerText().catch(() => "");
  check("recherche « P-01 » depuis le déneigement : capteur de l'aqueduc proposé", /P-01/.test(option) && /Aqueduc/.test(option), option.replace(/\n/g, " "));
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  await p.waitForURL(`**${AQ}**`, { timeout: 10_000 }).catch(() => {});
  const found = await p.locator("[data-testid=inspector]").innerText({ timeout: 15_000 }).catch(() => "");
  const sel = await p.evaluate(() => ({ sel: (window as any).__aqueduc?.store.getState().selection, focus: (window as any).__territoire.store.getState().focus, same: (window as any).__territoire.map === (window as any).__mapRef }));
  check("→ /carte/aqueduc, même carte, fiche du capteur P-01 ouverte, focus consommé", new URL(p.url()).pathname === AQ && sel.same && found.includes("P-01") && sel.sel?.id === "P-01" && sel.focus === null, `${p.url()} ${JSON.stringify(sel)}`);
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
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
  console.log(`\n== ${AQ} avec JavaScript, mode classique`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}?mode=classic`);
  await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
  await pin(p);
  check("vue SSR masquée une fois l'application montée", !(await p.locator(".aq-ssr").isVisible()));
  const st = await p.evaluate(() => (window as any).__aqueduc.territoire.getState().mode);
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
  // les statuts des étiquettes suivent le flux avec un léger retard : lancé après 14 h (heure réelle),
  // l'heure épinglée de midi remplace un réseau en bris, dont les alertes mettent ~1 s à retomber
  let ageTags = await shownTags(p);
  for (let i = 0; i < 12 && !ageTags.every((t) => t.st > 0); i++) {
    await p.waitForTimeout(250);
    ageTags = await shownTags(p);
  }
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
  console.log(`\n== ${AQ}?mode=hic (HTML-in-Canvas : secteurs et capteurs dans la scène)`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  await pin(p);
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
    const st = w.__aqueduc.territoire.getState();
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
  console.log(`\n== ${AQ}?mode=hic, vue souterraine (tubes 3D)`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc?.tubes && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  await pin(p);
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
  const extra = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>(".aq-stage > *")].filter((e) => e.offsetParent !== null && !e.matches(".aq-map, .aq-panel, .tr-switcher")).map((e) => e.className));
  check("rien d'autre ne flotte : panneau, sélecteur et frise seulement", floating.length === 2 && floating.some((c) => c.includes("aq-layers")) && floating.some((c) => c.includes("aq-timeline")) && extra.length === 0, [...floating, ...extra].join(" | "));
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
  const fallback = await p.evaluate(() => (window as any).__aqueduc.territoire.getState().fallback);
  check("pas de repli en mode classique", !fallback, fallback);
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Lance le scénario par la barre et passe à l'étape d'isolation ; renvoie l'heure simulée quittée. */
async function toIsolation(p: Page) {
  const before = await p.evaluate(() => {
    const { clock } = (window as any).__aqueduc.territoire.getState();
    return { t0: clock.t0, startedAt: clock.startedAt, speed: clock.speed };
  });
  await p.getByRole("button", { name: "Lancer le scénario de bris" }).click();
  const story = p.locator("[data-testid=story]");
  await story.waitFor({ timeout: 5_000 }).catch(() => {});
  const text = (await story.count()) ? await story.innerText() : "";
  check("récit à gauche, étapes et mention « simulé »", /Détection/.test(text) && /Rapport/.test(text) && /simul/i.test(text), text.slice(0, 80).replace(/\n/g, " "));
  check("couches et recherche masquées pendant le scénario", (await p.locator(".aq-layers").count()) === 0 && !(await p.locator(".aq-search").isVisible()));
  await p.getByRole("button", { name: "Étape suivante", exact: true }).click();
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
    return { active: st.scenario.active, t0: w.__aqueduc.territoire.getState().clock.t0, incident: st.incident, cut: w.__hicMap?.layer ? [...w.__hicMap.layer.panels.keys()].some((k: string) => k.startsWith("cut:")) : false };
  });
  // l'incident découle de l'horloge commune : celui de l'heure quittée (bris de 14:00 de la journée)
  const afterBreak = localTime(resumeAt) >= "14:00";
  check("« Explorer librement » : scénario vidé, incident de l'heure quittée", !r.active && (r.incident !== null) === afterBreak, `${localTime(resumeAt)}, incident ${r.incident ? "présent" : "absent"}`);
  check("horloge revenue à l'heure quittée", r.t0 === resumeAt, `${r.t0} / ${resumeAt}`);
  check("récit et coupe démontés, couches revenues", (await p.locator("[data-testid=story]").count()) === 0 && !r.cut && (await p.locator(".aq-layers").count()) === 1);
}

/** Scénario en mode HTML-in-Canvas : coupe sous la rue, vannes cliquées dans la scène, export vidéo. */
async function scenarioHic(b: Browser) {
  console.log(`\n== ${AQ}?mode=hic, scénario de bris (coupe sous la rue, vannes, vidéo)`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  await pin(p);
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
    return { keys, valves: cut ? [...cut.querySelectorAll("button.aq-valve")].map((e) => e.textContent) : [], panels, fallback: w.__aqueduc.territoire.getState().fallback };
  });
  check("coupe cut:13C1949 montée dans la scène, capturée", cutOk && r.keys.includes("cut:13C1949"), r.keys.join(" "));
  check("le marquage de l'incident laisse la place à la coupe", !r.keys.includes("incident:13C1949"));
  check("deux vannes, vrais boutons « V-xx · à fermer »", r.valves.length === 2 && r.valves.every((t) => /^V-\d+ · à fermer$/.test(t ?? "")), r.valves.join(" | "));
  check("rien d'autre ne flotte : récit et frise seulement (et le sélecteur)", r.panels.length === 2 && r.panels.some((c) => c.includes("aq-story")) && r.panels.some((c) => c.includes("aq-timeline")), r.panels.join(" | "));
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
  for (let i = 0; i < 3; i++) await p.getByRole("button", { name: "Étape suivante", exact: true }).click();
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
  console.log(`\n== ${AQ}?mode=classic, scénario de bris (coupe dans la fiche)`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}?mode=classic`);
  await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
  await pin(p);
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

/** R19-4 : la barre d'application à plusieurs largeurs ; le bouton du scénario, dans le panneau, reste visible. */
async function appBar(b: Browser) {
  console.log("\n== barre d'application, plusieurs largeurs");
  for (const [w, minSearch] of [[1440, 240], [1280, 200], [1024, 140], [768, 140], [390, 200]] as const) {
    const ctx = await b.newContext({ viewport: { width: w, height: 860 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(`${BASE}${AQ}?mode=classic`);
    await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
    await p.waitForTimeout(600);
    await barFits(p, `${w} px`, minSearch);
    const launch = await p.locator(".aq-layers .aq-launch").isVisible();
    check(`${w} px : bouton du scénario visible (panneau de l'aqueduc)`, launch);
    const perf = await p.locator(".aq-perf").count();
    check(`${w} px : pas d'indicateur de performance sans ?perf=1`, perf === 0, String(perf));
    if (w === 1440 && process.env.SHOT_BAR_1440) await p.screenshot({ path: process.env.SHOT_BAR_1440, clip: { x: 0, y: 0, width: w, height: 120 } });
    if (w === 1024 && process.env.SHOT_BAR_1024) await p.screenshot({ path: process.env.SHOT_BAR_1024, clip: { x: 0, y: 0, width: w, height: 120 } });
    await ctx.close();
  }
}

/**
 * Visiteur sans l'API (Chromium lancé sans CanvasDrawElement) : mode classique, bandeau, vidéo
 * seulement si le fichier répond 200 (publié : public/territoire/visite-hic.webm ; absence simulée par un 404),
 * explication « Comment l'activer », fermeture retenue pour la session.
 */
async function withoutApi() {
  console.log(`\n== ${AQ} sans l'API HTML-in-Canvas`);
  const nb = await chromium.launch({ args: ["--disable-blink-features=CanvasDrawElement"] });
  try {
    const open = async (video: boolean, path = AQ, width = 1440) => {
      const ctx = await nb.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 1 });
      // le fichier est publié (tâche 12) : son absence est simulée par un 404, sa présence par un vrai 200
      if (!video) await ctx.route("**/territoire/visite-hic.webm", (r) => r.fulfill({ status: 404, body: "" }));
      const p = await ctx.newPage();
      const errors = collectErrors(p);
      await p.goto(`${BASE}${path}`);
      await p.waitForFunction(() => (window as any).__aqueduc, null, { timeout: 45_000 });
      await pin(p);
      return { ctx, p, errors };
    };
    const banner = (p: Page) => p.locator("[data-testid=noapi]");

    // 1) sans fichier vidéo : bandeau, pas de bouton vidéo
    let { ctx, p, errors } = await open(false);
    const st = await p.evaluate(() => {
      const s = (window as any).__aqueduc.territoire.getState();
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
      check("le bouton ouvre un <video controls> sur visite-hic.webm", /\/territoire\/visite-hic\.webm$/.test(src ?? ""), String(src));
      const dlg = await p.evaluate(() => {
        const d = document.querySelector<HTMLDialogElement>("dialog.aq-noapi-video");
        return { open: !!d?.open, modal: !!d?.matches(":modal"), focusIn: !!d?.contains(document.activeElement), caption: d?.querySelector(".aq-noapi-credits")?.textContent ?? "" };
      });
      check("vidéo dans un <dialog> modal natif, focus à l'intérieur", dlg.open && dlg.modal && dlg.focusIn, JSON.stringify(dlg));
      check("légende de la vidéo : conduites, zones, météo, fond de carte, simulation", /Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4\.0/.test(dlg.caption) && /Zones de stationnement de nuit/.test(dlg.caption) && /Météo : Environnement et Changement climatique Canada/.test(dlg.caption) && /OpenFreeMap \/ OpenMapTiles \/ OpenStreetMap/.test(dlg.caption) && /simulation/.test(dlg.caption), dlg.caption);
      // Tab ne sort pas du dialogue (le navigateur rend la page inerte)
      for (let i = 0; i < 4; i++) await p.keyboard.press("Tab");
      check("Tab reste dans le dialogue", await p.evaluate(() => !!document.querySelector("dialog.aq-noapi-video")?.contains(document.activeElement)));
      await p.keyboard.press("Escape");
      // le dialogue se ferme aussitôt ; la vidéo est retirée au rendu React qui suit (jusqu'à ~150 ms)
      await p.locator("video[controls]").waitFor({ state: "detached", timeout: 2_000 }).catch(() => {});
      check("Échap referme la vidéo", (await p.locator("video[controls]").count()) === 0);
      check("le focus revient au bouton d'ouverture", await p.evaluate(() => document.activeElement?.textContent === "Voir la version HTML-in-Canvas en vidéo"));
    }
    await ctx.close();

    // 3) ?mode=hic sans l'API : repli expliqué
    ({ ctx, p, errors } = await open(false, `${AQ}?mode=hic`));
    const fb = await p.evaluate(() => { const s = (window as any).__aqueduc.territoire.getState(); return { mode: s.mode, fallback: s.fallback }; });
    check("?mode=hic sans l'API : repli classique expliqué", fb.mode === "classic" && /API HTML-in-Canvas absente/.test(fb.fallback), fb.fallback);
    check("bouton « HTML-in-Canvas » désactivé", await p.getByRole("button", { name: "HTML-in-Canvas", exact: true }).isDisabled());
    await ctx.close();

    // 4) mobile : aucun défilement horizontal avec le bandeau
    ({ ctx, p, errors } = await open(false, AQ, 390));
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
  console.log(`\n== ${AQ} repli HTML-in-Canvas après vérification : note visible`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${AQ}?mode=hic`);
  await p.waitForFunction(() => (window as any).__aqueduc && (window as any).__hicMap?.layer, null, { timeout: 45_000 });
  await pin(p);
  check("API présente : pas de bandeau avant le repli", (await p.locator("[data-testid=noapi]").count()) === 0);
  // même écriture que `onFallback` de la scène (texture vide, aucun paint…)
  await p.evaluate(() => (window as any).__aqueduc.territoire.setState({ mode: "classic", fallback: "Mode classique activé automatiquement : texture vide (test)." }));
  const note = p.locator("[data-testid=noapi-lost]");
  await note.waitFor({ timeout: 5_000 }).catch(() => {});
  const text = (await note.count()) ? await note.innerText() : "";
  check("note de repli visible : raison et mode classique", /s'est désactivé pendant l'affichage/.test(text) && text.includes("texture vide (test)"), text.slice(0, 140));
  check("note de repli : pas de « Comment l'activer » (l'API est présente)", (await p.getByRole("button", { name: "Comment l'activer" }).count()) === 0);
  // M5 : un retour manuel à HTML-in-Canvas efface la raison ; revenir ensuite en classique ne la ressort pas
  await p.getByRole("button", { name: "HTML-in-Canvas", exact: true }).click();
  await p.waitForTimeout(500);
  const back = await p.evaluate(() => { const s = (window as any).__aqueduc.territoire.getState(); return { mode: s.mode, fallback: s.fallback }; });
  check("retour manuel à HTML-in-Canvas : raison du repli effacée", back.mode === "hic" && back.fallback === "", JSON.stringify(back));
  await p.getByRole("button", { name: "Classique", exact: true }).click();
  await p.waitForTimeout(500);
  check("puis Classique : pas de note périmée « s'est désactivé pendant l'affichage »", (await p.locator("[data-testid=noapi]").count()) === 0);
  await p.evaluate(() => (window as any).__aqueduc.territoire.setState({ mode: "classic", fallback: "Mode classique activé automatiquement : texture vide (test)." }));
  await note.waitFor({ timeout: 5_000 }).catch(() => {});
  await p.getByRole("button", { name: "Fermer le bandeau" }).click();
  check("note refermable", (await p.locator("[data-testid=noapi]").count()) === 0);
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Heure de la journée de référence (`SCENARIO_DAY`) placée sur l'horloge commune, ×1. */
async function setClock(p: Page, at: number) {
  await p.waitForFunction(() => (window as any).__territoire?.store, null, { timeout: 45_000 });
  await p.evaluate((t) => (window as any).__territoire.store.setState({ clock: { t0: t, speed: 1, startedAt: Date.now() } }), at);
}

/** Accueil sans JavaScript : avertissement, alertes (ou « Aucune alerte »), environnements, météo, pied. */
async function homeWithoutJs(b: Browser) {
  console.log("\n== / (accueil) sans JavaScript");
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const res = await p.goto(`${BASE}/`);
  const text = await p.locator("body").innerText();
  check("statut 200, titre « Vue d'ensemble »", res?.status() === 200 && (await p.locator("h1").innerText()).startsWith("Vue d'ensemble · "), `${res?.status()} ${await p.locator("h1").innerText()}`);
  check("« Démo non officielle » et « Simulation »", text.includes("Démo non officielle") && text.includes("Simulation"));
  const alerts = await p.locator(".tr-alert").count();
  check("au moins une alerte, ou « Aucune alerte »", alerts > 0 || text.includes("Aucune alerte"), `${alerts} alerte(s)`);
  const cards = await p.locator(".tr-envcard").evaluateAll((els) => els.map((e) => ({ env: e.getAttribute("data-env"), href: e.querySelector("a")?.getAttribute("href") ?? null })));
  check(
    "5 environnements dans l'ordre ; seuls Aqueduc et Déneigement mènent à leur vue",
    JSON.stringify(cards) === JSON.stringify([
      { env: "aqueduc", href: "/carte/aqueduc" },
      { env: "deneigement", href: "/carte/deneigement" },
      { env: "collecte", href: null },
      { env: "zonage", href: null },
      { env: "evaluation", href: null },
    ]),
    JSON.stringify(cards),
  );
  const credit = (await p.locator(".tr-home-envs .tr-envcards-credit").innerText().catch(() => "")) || "";
  const creditBox = await p.locator(".tr-envcards-credit").boundingBox();
  const lastCard = await p.locator(".tr-envcard").last().boundingBox();
  check(
    "vignettes : crédit visible sous les cartes (fond de carte OpenFreeMap / OpenMapTiles / OpenStreetMap ; conduites et zones, Ville de Trois-Rivières, CC-BY 4.0)",
    credit.includes("Fond de carte : OpenFreeMap / OpenMapTiles / OpenStreetMap") && credit.includes("Conduites et zones : Ville de Trois-Rivières, Données Québec, CC-BY 4.0") && !!creditBox && creditBox.height > 0 && !!lastCard && creditBox.y >= lastCard.y + lastCard.height,
    credit,
  );
  check("« À venir » : 3 prochains événements", (await p.locator(".tr-next-list li").count()) === 3);
  check("météo (ou « Météo indisponible ») avec son attribution", /Météo : Environnement et Changement climatique Canada/.test(text) && (/°C/.test(text) || text.includes("Météo indisponible")));
  check("pied : « Démo non officielle · données ouvertes CC-BY 4.0 · À propos »", (await p.locator(".tr-home-foot").innerText()).includes("Démo non officielle · données ouvertes CC-BY 4.0 · À propos") && (await p.locator('.tr-home-foot a[href="/a-propos"]').count()) === 1);
  await ctx.close();
}

/**
 * Accueil avec JavaScript : l'îlot suit l'horloge commune (placée à 14:05) ; cloche au clavier ;
 * « Ouvrir » sur le bris mène à /carte/aqueduc, sans rechargement, avec l'incident sélectionné.
 */
async function homeJs(b: Browser) {
  console.log("\n== / (accueil) avec JavaScript : horloge à 14:05, cloche, « Ouvrir » le bris");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/?mode=classic`);
  await setClock(p, atHour(SCENARIO_DAY, "14:05"));
  await p.evaluate(() => ((window as any).__noReload = true));
  const brisRow = p.locator(".tr-alert", { hasText: "Bris de conduite 13C1949" });
  const shown = await brisRow.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
  const stamp = await p.locator(".tr-home-stamp").innerText();
  check("îlot recalculé à l'heure simulée : « mardi 24 nov., 14 h 05 », bris critique en tête", shown && stamp === "mardi 24 nov., 14 h 05" && (await p.locator(".tr-alert").first().getAttribute("data-sev")) === "critique", stamp);
  check("carte de l'aqueduc : « 1 bris non isolé »", (await p.locator('.tr-envcard[data-env="aqueduc"] .tr-status').innerText()).includes("1 bris non isolé"));
  if (process.env.SHOT_HOME) {
    await p.screenshot({ path: process.env.SHOT_HOME, fullPage: true });
    console.log(`capture : ${process.env.SHOT_HOME}`);
  }

  // cloche : nom accessible, clavier, Échap et retour du focus
  const bell = p.locator(".tr-bell-btn");
  const label = (await bell.getAttribute("aria-label")) ?? "";
  check("cloche : nombre d'alertes et gravité dans le nom accessible", /^Alertes : \d+ actives? \(.*1 critique/.test(label) && (await bell.getAttribute("aria-expanded")) === "false", label);
  await bell.focus();
  await p.keyboard.press("Enter");
  const pop = p.getByRole("dialog", { name: "Alertes" });
  await pop.waitFor({ timeout: 5_000 }).catch(() => {});
  const first = await p.evaluate(() => document.activeElement?.classList.contains("tr-bell-item") && document.activeElement.textContent);
  check("ouverture : menu « Alertes » (dialog), aria-expanded, focus sur la première alerte", (await pop.count()) === 1 && (await bell.getAttribute("aria-expanded")) === "true" && typeof first === "string" && first.includes("Bris de conduite"), String(first));
  if (process.env.SHOT_BELL) {
    await p.screenshot({ path: process.env.SHOT_BELL });
    console.log(`capture : ${process.env.SHOT_BELL}`);
  }
  const n = await pop.locator(".tr-bell-item").count();
  await p.keyboard.press("ArrowUp");
  const last = await p.evaluate(() => [...document.querySelectorAll(".tr-bell-item")].indexOf(document.activeElement as Element));
  check("flèche haut depuis la première : dernière alerte", last === n - 1, `${last} / ${n}`);
  await p.keyboard.press("Escape");
  check("Échap : menu refermé, focus rendu à la cloche", (await pop.count()) === 0 && (await p.evaluate(() => !!document.activeElement?.classList.contains("tr-bell-btn"))));

  // « Ouvrir » le bris : même horloge (pas de rechargement), incident sélectionné, focus consommé
  await brisRow.getByRole("link", { name: /Ouvrir/ }).click();
  const moved = await p.waitForURL("**/carte/aqueduc?mode=classic", { timeout: 10_000 }).then(() => true).catch(() => false);
  await p.waitForFunction(() => (window as any).__aqueduc?.store.getState().selection, null, { timeout: 45_000 }).catch(() => {});
  const st = await p.evaluate(() => {
    const w = window as any;
    return { sel: w.__aqueduc?.store.getState().selection, incident: !!w.__aqueduc?.store.getState().incident, focus: w.__territoire?.store.getState().focus, noReload: w.__noReload === true, mode: w.__territoire?.store.getState().mode };
  });
  const insp = await p.locator("[data-testid=inspector]").innerText({ timeout: 10_000 }).catch(() => "");
  check(
    "→ /carte/aqueduc?mode=classic sans rechargement, incident 13C1949 sélectionné (fiche ouverte), focus consommé",
    moved && st.noReload && st.mode === "classic" && st.sel?.kind === "incident" && st.sel?.id === "13C1949" && st.incident && st.focus === null && insp.includes("13C1949"),
    `${p.url()} ${JSON.stringify(st)}`,
  );
  const clock = await p.evaluate(() => (window as any).__territoire.store.getState().clock.t0);
  check("horloge commune gardée (14:05)", localTime(clock) === "14:05", localTime(clock));
  check("aucune erreur console (hydratation comprise)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/**
 * Cloche dans une vue 3D : une alerte d'un autre environnement y mène et met l'objet en avant ;
 * un focus du déneigement (recherche) ne reste pas après l'arrivée.
 */
async function bellInScene(b: Browser) {
  console.log("\n== cloche dans une vue 3D, focus de l'environnement visé seulement");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/carte/deneigement?mode=classic`);
  await p.locator(".tr-envpanel h2", { hasText: "Déneigement" }).waitFor({ timeout: 45_000 }).catch(() => {});
  await setClock(p, atHour(SCENARIO_DAY, "14:05"));
  await p.waitForTimeout(1200);
  await p.locator(".tr-bell-btn").click();
  const item = p.locator(".tr-bell-item", { hasText: "Bris de conduite 13C1949" });
  const listed = await item.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
  check("depuis le déneigement : la cloche liste le bris de l'aqueduc", listed);
  await item.click();
  await p.waitForURL("**/carte/aqueduc?mode=classic", { timeout: 10_000 }).catch(() => {});
  await p.waitForFunction(() => (window as any).__aqueduc?.store.getState().selection, null, { timeout: 20_000 }).catch(() => {});
  const st = await p.evaluate(() => ({ sel: (window as any).__aqueduc?.store.getState().selection, focus: (window as any).__territoire.store.getState().focus }));
  check("→ /carte/aqueduc, incident sélectionné, focus consommé", new URL(p.url()).pathname === AQ && st.sel?.kind === "incident" && st.sel?.id === "13C1949" && st.focus === null, JSON.stringify(st));
  // même environnement : la cloche sélectionne sans naviguer
  await p.evaluate(() => (window as any).__aqueduc.store.setState({ selection: null }));
  await p.locator(".tr-bell-btn").click();
  await p.locator(".tr-bell-item", { hasText: "Bris de conduite" }).click();
  await p.waitForTimeout(300);
  const same = await p.evaluate(() => ({ sel: (window as any).__aqueduc?.store.getState().selection, focus: (window as any).__territoire.store.getState().focus }));
  check("dans l'aqueduc : l'alerte sélectionne l'incident sans changer d'URL", new URL(p.url()).pathname === AQ && same.sel?.kind === "incident" && same.focus === null, JSON.stringify(same));
  // recherche d'une zone du déneigement : le focus est consommé à l'arrivée (rien ne traîne)
  await p.locator(".aq-search input").fill("Zone A");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  await p.waitForURL("**/carte/deneigement**", { timeout: 10_000 }).catch(() => {});
  await p.locator(".tr-envpanel h2", { hasText: "Déneigement" }).waitFor({ timeout: 10_000 }).catch(() => {});
  await p.waitForTimeout(300);
  const f = await p.evaluate(() => (window as any).__territoire.store.getState().focus);
  const zoneCard = await p.locator("[data-testid=inspector]").innerText({ timeout: 10_000 }).catch(() => "");
  check("recherche « Zone A » : arrivée au déneigement, focus consommé, fiche « Zone A » ouverte", new URL(p.url()).pathname === "/carte/deneigement" && f === null && /Zone A\s+Zone de stationnement de nuit/.test(zoneCard), `${JSON.stringify(f)} ${zoneCard.slice(0, 60).replace(/\n/g, " ")}`);
  // une ressource, dans le même environnement : sa fiche, focus consommé
  await p.locator(".aq-search input").fill("CH-02");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  const resCard = await p.locator("[data-testid=inspector]", { hasText: "CH-02" }).innerText({ timeout: 5_000 }).catch(() => "");
  const f2 = await p.evaluate(() => (window as any).__territoire.store.getState().focus);
  check("recherche « CH-02 » dans le déneigement : fiche de la ressource (chenillette, zone assignée), focus consommé", resCard.includes("Chenillette") && resCard.includes("Zone assignée") && f2 === null, resCard.slice(0, 80).replace(/\n/g, " "));
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** « À propos » : phrase « non officielle », quatre lignes de licence, sources, lien vers le banc. */
async function aboutPage(b: Browser) {
  console.log("\n== /a-propos");
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const res = await p.goto(`${BASE}/a-propos`);
  const text = await p.locator("body").innerText();
  check("statut 200", res?.status() === 200, String(res?.status()));
  check("phrase « non officielle » mot pour mot", text.includes("Démo non officielle. Ni la Ville de Trois-Rivières ni aucune autre municipalité n'a produit, vérifié ou approuvé cette démo."));
  const lines = [
    "Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4.0",
    "Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0",
    "Météo : Environnement et Changement climatique Canada (Licence du gouvernement ouvert – Canada)",
    "Fond de carte : OpenFreeMap / OpenMapTiles / OpenStreetMap",
  ];
  check("les quatre lignes de licence", lines.every((l) => text.includes(l)), lines.filter((l) => !text.includes(l)).join(" | "));
  check("tableau des sources : 4 jeux, éditeur, licence et lien", (await p.locator(".tr-table").first().locator("tbody tr").count()) === 4 && (await p.locator('a[href^="https://www.donneesquebec.ca/"]').count()) === 2);
  check("réel et simulé pour les 5 environnements ; constantes 10 h 00 et 15 h 00", (await p.locator("tr[data-env]").count()) === 5 && text.includes("10 h 00") && text.includes("15 h 00"));
  check("lien vers le banc (/bench) et retour à l'accueil", (await p.locator('main a[href="/bench"]').count()) === 1 && (await p.locator('a[href="/"]').count()) >= 1);
  if (process.env.SHOT_ABOUT) {
    await p.screenshot({ path: process.env.SHOT_ABOUT, fullPage: true });
    console.log(`capture : ${process.env.SHOT_ABOUT}`);
  }
  await ctx.close();
}

async function benchPage() {
  console.log("\n== /bench");
  const r = await fetch(`${BASE}/bench`);
  check("/bench → 200", r.status === 200, String(r.status));
  const html = await r.text();
  check("/bench : section « Réseau d'eau » (ancre #aqueduc) et lien de retour vers l'accueil (/)", html.includes('id="aqueduc"') && /<nav[^>]*>.*?<a[^>]*href="\/"/s.test(html));
  const csv = await fetch(`${BASE}/bench/aqueduc.csv`);
  check("/bench/aqueduc.csv → 200", csv.status === 200, String(csv.status));
}


/** Plans du déneigement par `window.__territoire.snow` : « A:programmee »… */
const snowPlans = (p: Page) => p.evaluate(() => ((window as any).__territoire.snow.plans() as { zone: string; ban: string; lights: string }[]).map((x) => `${x.zone}:${x.ban}`).join(" "));

/** État (feature-state) des feux d'une zone, lus par querySourceFeatures. */
const lightStates = (p: Page, zone: string) =>
  p.evaluate((z) => {
    const map = (window as any).__territoire.map;
    const ids = new Set<string>(map.querySourceFeatures("dn-lights").filter((f: any) => f.properties.zone === z).map((f: any) => String(f.id)));
    const out: Record<string, number> = {};
    for (const id of ids) {
      const st = map.getFeatureState({ source: "dn-lights", id }).lights ?? "eteint";
      out[st] = (out[st] ?? 0) + 1;
    }
    return out;
  }, zone);

/** Textes du menu de la cloche (ouvert puis refermé). */
async function bellText(p: Page) {
  await p.locator(".tr-bell-btn").click();
  const pop = p.getByRole("dialog", { name: "Alertes" });
  await pop.waitFor({ timeout: 5_000 }).catch(() => {});
  const text = await pop.innerText().catch(() => "");
  await p.keyboard.press("Escape");
  return text;
}

/**
 * Déneigement (HTML-in-Canvas ou classique), horloge épinglée : décision en deux gestes à 08:00
 * (A et B programmées, C non, alerte « décider » retirée de la cloche), interdiction en vigueur et
 * feux de A allumés (et clignotants) à 23:30, fiche de la zone A au clic sur son marquage ; à 00:30,
 * une décision change la nuit en cours tout de suite (R11) ; à 16:00 sur une page neuve, la décision
 * reste possible, avec une mise en garde (R11 : jamais bloquée). La légende (mention de simulation,
 * attribution des zones) est visible sans défiler à 1440 × 860.
 */
/**
 * Mention de simulation et attribution des zones de la légende : dans le pied fixe du panneau (hors de
 * la zone qui défile), entières dans le panneau et non recouvertes (élément du dessus en leur centre).
 */
async function legendVisible(p: Page) {
  return p.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".dn-panel");
    const items = [document.querySelector<HTMLElement>(".dn-sim-note"), document.querySelector<HTMLElement>(".dn-legend .dn-credit")];
    if (!panel || items.some((e) => !e)) return { ok: false, detail: "absent" };
    const r = panel.getBoundingClientRect();
    const ok = items.map((e) => {
      const q = e!.getBoundingClientRect();
      const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return q.height > 0 && q.top >= r.top && q.bottom <= r.bottom + 0.5 && !!top && e!.contains(top) && !!e!.closest(".tr-envpanel-foot") && !e!.closest(".tr-envpanel-scroll");
    });
    return { ok: ok.every(Boolean), detail: `panneau ${Math.round(r.top)}–${Math.round(r.bottom)} · ${items.map((e) => { const q = e!.getBoundingClientRect(); return `${Math.round(q.top)}–${Math.round(q.bottom)}`; }).join(" ")}` };
  });
}

async function deneigement(b: Browser, mode: "hic" | "classic") {
  const DN = `/carte/deneigement?mode=${mode}`;
  console.log(`\n== ${DN} : décision de l'interdiction, feux, fiche de zone`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}${DN}`);
  await p.waitForFunction(() => (window as any).__territoire?.snow, null, { timeout: 45_000 });
  await setClock(p, atHour(SCENARIO_DAY, "10:30"));
  if (mode === "hic") {
    const active = await p
      .waitForFunction(() => {
        const w = window as any;
        const L = w.__hicMap?.layer;
        return w.__territoire.store.getState().api === "active" && L && ["zone:A", "zone:B", "zone:C"].every((k) => L.panels.get(k)?.tex);
      }, null, { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    const st = await p.evaluate(() => ({ mode: (window as any).__territoire.store.getState().mode, keys: [...(window as any).__hicMap.layer.panels.keys()].sort().join(" "), markers: document.querySelectorAll(".maplibregl-marker").length }));
    check("HTML-in-Canvas actif : trois marquages au sol zone:A, zone:B, zone:C capturés, aucun marqueur DOM", active && st.mode === "hic" && st.keys === "zone:A zone:B zone:C" && st.markers === 0, JSON.stringify(st));
  } else {
    const n = await p.locator(".dn-flat .dn-mark").count();
    check("mode classique : trois étiquettes de zones (marqueurs DOM)", n === 3, String(n));
  }
  await p.waitForTimeout(1200);
  const marks = await p.evaluate((hic) => {
    const sel = hic ? '.maplibregl-canvas > [data-panel^="zone:"]' : ".dn-flat .dn-mark";
    return [...document.querySelectorAll<HTMLElement>(sel)].map((e) => ({ name: e.querySelector(".dn-mark-name")?.textContent, state: e.querySelector(".dn-mark-state")?.textContent ?? null, figs: e.querySelectorAll(".aq-num").length, focusable: e.tabIndex >= 0 && e.tagName === "BUTTON" }));
  }, mode === "hic");
  check(
    "10:30 : marquages « Zone A/B/C », « Interdiction ce soir » (décision par défaut), un seul chiffre chacun, focusables",
    marks.length === 3 && marks.every((m) => /^Zone [ABC]$/.test(m.name ?? "") && m.state === "Interdiction ce soir" && m.figs === 1 && m.focusable),
    JSON.stringify(marks),
  );
  const panel = await p.locator(".dn-panel").innerText();
  check("panneau : météo (source, neige des prochaines 36 h, crédit), « Décidée à 10 h 00 par la direction (simulé) »", /Neige · prochaines 36 h/i.test(panel) && /(Environnement Canada|Simulation)/.test(panel) && /Météo : Environnement et Changement climatique Canada/.test(panel) && panel.includes("Décidée à 10 h 00 par la direction (simulé)"), panel.slice(0, 200).replace(/\n/g, " | "));
  check("légende : « Simulation : feux inspirés du système de la Ville de Québec » et attribution des zones", panel.includes("Simulation : feux inspirés du système de la Ville de Québec") && panel.includes("Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0"));
  const leg1030 = await legendVisible(p);
  check("10:30, 1440 × 860 : mention de simulation et attribution des zones visibles sans défiler", leg1030.ok, leg1030.detail);
  if (mode === "hic" && process.env.SHOT_DN_1030) {
    await p.waitForTimeout(1500);
    await p.screenshot({ path: process.env.SHOT_DN_1030 });
    console.log(`capture : ${process.env.SHOT_DN_1030}`);
  }

  // 08:00 : décision en deux gestes
  await setClock(p, atHour(SCENARIO_DAY, "08:00"));
  await p.waitForTimeout(400);
  const before = await bellText(p);
  check("08:00 : la cloche demande de décider l'interdiction", /décider l'interdiction/.test(before), before.slice(0, 120).replace(/\n/g, " | "));
  const box = (z: string) => p.locator(".dn-zone-opt", { hasText: `Zone ${z}` }).locator("input");
  // rien de coché : le bouton dit ce qu'il fait (« Aucune interdiction ce soir ») et une ligne l'explique
  const emptyBtn = p.locator(".dn-decide-btn");
  const emptyNote = (await p.locator(".dn-caution").innerText().catch(() => "")) || "";
  check(
    "08:00 : aucune zone cochée ; bouton actif « Aucune interdiction ce soir », effet expliqué (aria-describedby)",
    !(await box("A").isChecked()) && !(await box("B").isChecked()) && !(await box("C").isChecked()) && (await emptyBtn.innerText()) === "Aucune interdiction ce soir" && (await emptyBtn.isEnabled()) && /pas d'interdiction ce soir/.test(emptyNote) && (await emptyBtn.getAttribute("aria-describedby")) === (await p.locator(".dn-caution").getAttribute("id")),
    `${await emptyBtn.innerText()} · ${emptyNote}`,
  );
  await box("A").check();
  await box("B").check();
  const dirty = await p.locator(".dn-decided").innerText();
  check("A et B cochées, non enregistrées : « Modifications non enregistrées », bouton « Décider pour ce soir », aucune action encore", dirty.includes("Modifications non enregistrées") && (await p.evaluate(() => (window as any).__territoire.store.getState().actions.length)) === 0, dirty);
  await p.getByRole("button", { name: "Décider pour ce soir" }).click();
  await p.waitForTimeout(300);
  check("A et B programmées, C sans interdiction (__territoire.snow.plans)", (await snowPlans(p)) === "A:programmee B:programmee C:aucune", await snowPlans(p));
  check("panneau : « Décidée par vous à 8 h 00 », plus de modification non enregistrée", (await p.locator(".dn-decided").innerText()).includes("Décidée par vous à 8 h 00") && !(await p.locator(".dn-decided").innerText()).includes("non enregistrées"), await p.locator(".dn-decided").innerText());
  const actions = await p.evaluate(() => (window as any).__territoire.store.getState().actions.map((a: any) => `${a.kind}:${(a.zones ?? []).join("")}`));
  check("une seule action « ban » A+B enregistrée", JSON.stringify(actions) === JSON.stringify(["ban:AB"]), JSON.stringify(actions));
  const after = await bellText(p);
  check("la cloche ne demande plus de « décider »", !/décider/i.test(after), after.slice(0, 120).replace(/\n/g, " | "));
  const prog = await lightStates(p, "A");
  check("feux de A programmés (feature-state)", (prog.programme ?? 0) > 0 && Object.keys(prog).length === 1, JSON.stringify(prog));

  // 23:30 : interdiction en vigueur, feux de A allumés et clignotants
  await setClock(p, atHour(SCENARIO_DAY, "23:30"));
  await p.waitForTimeout(1500);
  check("23:30 : A et B en vigueur, C sans interdiction", (await snowPlans(p)) === "A:en-vigueur B:en-vigueur C:aucune", await snowPlans(p));
  const lit = await lightStates(p, "A");
  const off = await lightStates(p, "C");
  check("23:30 : tous les feux de A allumés (querySourceFeatures + feature-state), ceux de C éteints", (lit.allume ?? 0) > 20 && Object.keys(lit).length === 1 && (off.eteint ?? 0) > 0 && Object.keys(off).length === 1, `A ${JSON.stringify(lit)} · C ${JSON.stringify(off)}`);
  const phases = new Set<string>();
  for (let i = 0; i < 5; i++) {
    phases.add(await p.evaluate(() => JSON.stringify((window as any).__territoire.map.getPaintProperty("dn-lights", "circle-opacity"))));
    await p.waitForTimeout(260);
  }
  check("feux allumés clignotants (circle-opacity alternée)", phases.size === 2, `${phases.size} phase(s)`);
  const leg2330 = await legendVisible(p);
  const night2330 = await p.locator(".dn-decide").innerText();
  check("23:30 : légende visible sans défiler ; « En vigueur jusqu'à 6 h », jamais « Trop tard »", leg2330.ok && night2330.includes("En vigueur jusqu'à 6 h") && !/trop tard/i.test(night2330), `${leg2330.detail} · ${night2330.replace(/\n/g, " | ")}`);
  const night = await p.evaluate((hic) => {
    const sel = hic ? '.maplibregl-canvas > [data-panel="zone:A"]' : ".dn-flat .dn-mark";
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.querySelector(".dn-mark-name")?.textContent === "Zone A");
    return { state: el?.querySelector(".dn-mark-state")?.textContent, fig: el?.querySelector(".dn-mark-fig")?.textContent };
  }, mode === "hic");
  check("marquage de A : « Stationnement interdit · 23 h – 6 h » et l'avancement en %", night.state === "Stationnement interdit · 23 h – 6 h" && /%\s*déneigé/.test(night.fig ?? ""), JSON.stringify(night));
  // captures dans chaque phase du clignotement : début de phase repéré, puis une image dessinée
  for (const [want, path] of [[1, process.env.SHOT_DN_2330], [0.4, process.env.SHOT_DN_2330_LOW]] as const) {
    if (mode !== "hic" || !path) continue;
    await p.waitForFunction(
      (v) => {
        const w = window as any;
        const cur = w.__territoire.map.getPaintProperty("dn-lights", "circle-opacity")[2];
        const fresh = cur === v && w.__dnPhase !== v;
        w.__dnPhase = cur;
        return fresh;
      },
      want,
      { timeout: 5_000, polling: 30 },
    ).catch(() => {});
    await p.waitForTimeout(120);
    await p.screenshot({ path });
    console.log(`capture : ${path}`);
  }

  // clic sur le marquage de A → fiche
  if (mode === "hic") {
    const pt = await p.evaluate(() => {
      const q = (window as any).__hicMap.layer.panels.get("zone:A");
      const box = (window as any).__territoire.map.getCanvas().getBoundingClientRect();
      if (!q?.proj) return null;
      const [x, y] = q.proj.project(q.w / 2, q.h * 0.3);
      return { x: box.left + x, y: box.top + y };
    });
    check("marquage de A dessiné dans la scène", !!pt);
    if (pt) {
      await p.mouse.move(pt.x, pt.y);
      await p.waitForTimeout(800);
      await p.mouse.click(pt.x, pt.y);
    }
  } else {
    await p.locator(".dn-flat .dn-mark", { hasText: "Zone A" }).click();
  }
  const card = await p.locator("[data-testid=inspector]").innerText({ timeout: 5_000 }).catch(() => "");
  check(
    "clic sur le marquage de A → fiche « Zone A » : état, décision, feux par état, ressources, avancement, attribution",
    /Zone A\s+Zone de stationnement de nuit/.test(card) && card.includes("Stationnement interdit · 23 h – 6 h") && card.includes("Décidée par vous à 8 h 00") && /Feux allumés\s+102/.test(card) && /Ressources assignées · 8/i.test(card) && card.includes("Avancement") && card.includes("Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0"),
    card.slice(0, 160).replace(/\n/g, " | "),
  );
  if (mode === "hic" && process.env.SHOT_DN_CARD) {
    await p.waitForTimeout(1500);
    await p.screenshot({ path: process.env.SHOT_DN_CARD });
    console.log(`capture : ${process.env.SHOT_DN_CARD}`);
  }
  // réaffectation de nuit (R5) : permise, la fiche suit
  await p.locator(".dn-res summary").click();
  await p.getByLabel(/Zone assignée à CH-01 \(/).selectOption("C");
  await p.waitForTimeout(300);
  const moved = await p.evaluate(() => (window as any).__territoire.snow.plans().find((x: any) => x.zone === "C").resources.includes("CH-01"));
  check("23:30 : réaffectation de CH-01 à la zone C appliquée (de nuit)", moved && /Ressources assignées · 7/i.test(await p.locator("[data-testid=inspector]").innerText()));
  await p.keyboard.press("Escape");
  check("Échap referme la fiche", (await p.locator("[data-testid=inspector]").count()) === 0);
  // R10 : la nuit appartient à l'opération de la veille ; la décision A+B de 08:00 tient à 00:30
  await setClock(p, atHour(atHour(SCENARIO_DAY, "12:00") + 24 * 3_600_000, "00:30"));
  await p.waitForTimeout(1500);
  const c030 = await lightStates(p, "C");
  const decided = await p.locator(".dn-decided").innerText();
  check(
    "R10, 00:30 le lendemain : A et B toujours en vigueur, C non (feux éteints), « Décidée par vous à 8 h 00 »",
    (await snowPlans(p)) === "A:en-vigueur B:en-vigueur C:aucune" && (c030.eteint ?? 0) > 0 && Object.keys(c030).length === 1 && decided.includes("Décidée par vous à 8 h 00"),
    `${await snowPlans(p)} · C ${JSON.stringify(c030)} · ${decided}`,
  );
  check("R10, 00:30 : la zone C n'a pas de case cochée", !(await box("C").isChecked()) && (await box("A").isChecked()));
  // R11 : à 00:30, une décision change la nuit en cours tout de suite (C ajoutée, feux allumés)
  await box("C").check();
  await p.getByRole("button", { name: "Appliquer à la nuit en cours" }).click();
  await p.waitForTimeout(1200);
  const c030b = await lightStates(p, "C");
  check(
    "R11, 00:30 : C ajoutée → A, B et C en vigueur tout de suite, feux de C allumés, « Décidée par vous à 0 h 30 »",
    (await snowPlans(p)) === "A:en-vigueur B:en-vigueur C:en-vigueur" && (c030b.allume ?? 0) > 0 && Object.keys(c030b).length === 1 && (await p.locator(".dn-decided").innerText()).includes("Décidée par vous à 0 h 30"),
    `${await snowPlans(p)} · C ${JSON.stringify(c030b)} · ${await p.locator(".dn-decided").innerText()}`,
  );
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // 16:00 sur une page neuve : décision tardive, toujours possible (R11)
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  const errors2 = collectErrors(p2);
  await p2.goto(`${BASE}${DN}`);
  await p2.waitForFunction(() => (window as any).__territoire?.snow, null, { timeout: 45_000 });
  await setClock(p2, atHour(SCENARIO_DAY, "16:00"));
  await p2.waitForTimeout(1200);
  const btn = p2.getByRole("button", { name: "Décider pour ce soir" });
  const describedBy = async () => {
    const id = (await btn.getAttribute("aria-describedby")) ?? "";
    return id ? await p2.locator(`[id="${id}"]`).innerText().catch(() => "") : "";
  };
  check("16:00 : décision par défaut gardée (A, B, C programmées par la direction), cases cochées en conséquence", (await snowPlans(p2)) === "A:programmee B:programmee C:programmee" && (await p2.locator(".dn-zone-opt input:checked").count()) === 3);
  const idle = await describedBy();
  const idlePanel = await p2.locator(".dn-decide").innerText();
  check(
    "16:00, rien de changé : « Décider pour ce soir » actif, aucune mise en garde « Décision tardive » à côté de « Décidée à 10 h 00 par la direction (simulé) »",
    (await btn.isEnabled()) && idle === "" && !/tardive/i.test(idlePanel) && idlePanel.includes("Décidée à 10 h 00 par la direction (simulé)"),
    `${idle} · ${idlePanel.replace(/\n/g, " | ")}`,
  );
  if (process.env.SHOT_DN_1600) {
    await p2.waitForTimeout(800);
    await p2.screenshot({ path: process.env.SHOT_DN_1600 });
    console.log(`capture : ${process.env.SHOT_DN_1600}`);
  }
  const box2 = (z: string) => p2.locator(".dn-zone-opt", { hasText: `Zone ${z}` }).locator("input");
  await box2("A").uncheck();
  await box2("C").uncheck();
  const reason = await describedBy();
  check(
    "R11, 16:00, choix en cours : bouton actif, mise en garde « Décision tardive : les résidents auront moins de temps pour déplacer leur véhicule. » (aria-describedby)",
    (await btn.isEnabled()) && reason === "Décision tardive : les résidents auront moins de temps pour déplacer leur véhicule.",
    reason,
  );
  await btn.click();
  await p2.waitForTimeout(300);
  check("R11, 16:00 : la décision (B seule) est acceptée et programme l'interdiction du soir", (await snowPlans(p2)) === "A:aucune B:programmee C:aucune" && (await p2.locator(".dn-decided").innerText()).includes("Décidée par vous à 16 h 00"), `${await snowPlans(p2)} · ${await p2.locator(".dn-decided").innerText()}`);
  check("16:00, une fois décidée : plus de mise en garde tardive", !/tardive/i.test(await p2.locator(".dn-decide").innerText()));
  const page16 = (await p2.locator("body").innerText()) + (await bellText(p2));
  check("16:00 : aucun « Trop tard » dans la page ni dans la cloche", !/trop tard/i.test(page16));
  check("aucune erreur console (16:00)", errors2.length === 0, errors2.join(" | "));
  await ctx2.close();
}

/**
 * Ruling P2 : `/api/territoire/meteo` répond 500 ; le panneau du déneigement affiche « Météo
 * indisponible » et garde la neige simulée, sans plantage ; l'API revenue (réponse de la fiche
 * réelle versionnée), « Réessayer » rétablit la prévision.
 */
async function meteoDown(b: Browser) {
  console.log("\n== /api/territoire/meteo → 500 : panneau du déneigement");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  let calls = 0;
  await ctx.route("**/api/territoire/meteo", (r) => {
    calls++;
    return r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"panne simulée"}' });
  });
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/carte/deneigement?mode=classic`);
  await p.waitForFunction(() => (window as any).__territoire?.snow, null, { timeout: 45_000 });
  await setClock(p, atHour(SCENARIO_DAY, "08:00"));
  const off = await p.locator(".dn-weather", { hasText: "Météo indisponible" }).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  const w = await p.locator(".dn-weather").innerText().catch(() => "");
  check("500 : « Météo indisponible », source « Simulation », 12 cm simulés, crédit météo", off && /Simulation/.test(w) && /12\s*cm/.test(w) && /Météo : Environnement et Changement climatique Canada/.test(w), w.replace(/\n/g, " | "));
  check("500 : le reste du panneau fonctionne (décision possible, plans calculés)", (await p.locator(".dn-decide-btn").isEnabled()) && (await snowPlans(p)) === "A:aucune B:aucune C:aucune");
  const legOff = await legendVisible(p);
  check("500, 08:00, 1440 × 860 : mention de simulation et attribution des zones visibles sans défiler", legOff.ok, legOff.detail);
  await setClock(p, atHour(SCENARIO_DAY, "23:30"));
  await p.waitForTimeout(800);
  const legOffNight = await legendVisible(p);
  check("500, 23:30 : légende visible sans défiler (« Météo indisponible » affichée)", legOffNight.ok && (await p.locator(".dn-weather-off").count()) === 1, legOffNight.detail);
  if (process.env.SHOT_DN_METEO_OFF) {
    await p.screenshot({ path: process.env.SHOT_DN_METEO_OFF });
    console.log(`capture : ${process.env.SHOT_DN_METEO_OFF}`);
  }
  await setClock(p, atHour(SCENARIO_DAY, "08:00"));
  await p.waitForTimeout(300);
  // l'API revient : la fiche réelle versionnée, avec 8 cm de neige pour la nuit
  const fixture = parseCityPage(JSON.parse(await readFile(new URL("../fixtures/eccc-citypage-snow.json", import.meta.url), "utf8")))!;
  fixture.periods = fixture.periods.map((x, i) => (i === 1 ? { ...x, snowCm: 8 } : { ...x, snowCm: null }));
  await ctx.unroute("**/api/territoire/meteo");
  await ctx.route("**/api/territoire/meteo", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ forecast: fixture }) }));
  await p.getByRole("button", { name: "Réessayer" }).click();
  const back = await p.locator(".dn-src", { hasText: "Environnement Canada" }).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  const w2 = await p.locator(".dn-weather").innerText().catch(() => "");
  check("API revenue, « Réessayer » : source « Environnement Canada », 8 cm, plus de « Météo indisponible »", back && /8\s*cm/.test(w2) && !w2.includes("Météo indisponible"), w2.replace(/\n/g, " | "));
  check("aucune exception (500 attendus en console seulement)", errors.length === 0 && calls >= 1, `${calls} appel(s) en panne · ${errors.join(" | ")}`);
  await ctx.close();
}

/**
 * Jour de neige réel : la fiche versionnée (eccc-citypage-snow) avec 8 cm ce soir et un avertissement
 * de neige ; la source est « Environnement Canada », l'avertissement s'affiche, et la légende reste
 * visible sans défiler à 1440 × 860 (le jour et la nuit).
 */
async function snowDay(b: Browser) {
  console.log("\n== jour de neige (fiche réelle + avertissement) : légende du déneigement");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const fixture = parseCityPage(JSON.parse(await readFile(new URL("../fixtures/eccc-citypage-snow.json", import.meta.url), "utf8")))!;
  fixture.periods = fixture.periods.map((x, i) => (i === 1 ? { ...x, snowCm: 8 } : { ...x, snowCm: null }));
  fixture.warnings = [{ title: "AVERTISSEMENT DE NEIGE EN VIGUEUR", type: "warning", expires: "" }];
  await ctx.route("**/api/territoire/meteo", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ forecast: fixture }) }));
  const p = await ctx.newPage();
  const errors = collectErrors(p);
  await p.goto(`${BASE}/carte/deneigement?mode=classic`);
  await p.waitForFunction(() => (window as any).__territoire?.snow, null, { timeout: 45_000 });
  await setClock(p, atHour(SCENARIO_DAY, "10:30"));
  const shown = await p.locator(".dn-weather-warn", { hasText: "AVERTISSEMENT DE NEIGE" }).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  const w = await p.locator(".dn-weather").innerText().catch(() => "");
  check("neige réelle : source « Environnement Canada », 8 cm, avertissement affiché", shown && /Environnement Canada/.test(w) && /8\s*cm/.test(w), w.replace(/\n/g, " | "));
  const legDay = await legendVisible(p);
  check("neige réelle, 10:30, 1440 × 860 : mention de simulation et attribution des zones visibles sans défiler", legDay.ok, legDay.detail);
  await setClock(p, atHour(SCENARIO_DAY, "23:30"));
  await p.waitForTimeout(800);
  const legNight = await legendVisible(p);
  check("neige réelle, 23:30 : légende visible sans défiler", legNight.ok, legNight.detail);
  if (process.env.SHOT_DN_SNOW) {
    await p.screenshot({ path: process.env.SHOT_DN_SNOW });
    console.log(`capture : ${process.env.SHOT_DN_SNOW}`);
  }
  // ressources dépliées : seul le milieu défile, la légende reste en place
  await p.locator(".dn-res summary").click();
  await p.waitForTimeout(300);
  const legOpen = await legendVisible(p);
  const scrolls = await p.evaluate(() => { const e = document.querySelector<HTMLElement>(".dn-panel .tr-envpanel-scroll"); return !!e && e.scrollHeight > e.clientHeight; });
  check("ressources dépliées : le milieu du panneau défile, la légende reste visible", legOpen.ok && scrolls, legOpen.detail);
  check("aucune erreur console", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

const b = await chromium.launch();
try {
  await homeWithoutJs(b);
  await homeJs(b);
  await aboutPage(b);
  await ssrWithoutJs(b);
  await routes();
  await bellInScene(b);
  await deneigement(b, "hic");
  await deneigement(b, "classic");
  await meteoDown(b);
  await snowDay(b);
  await envSwitch(b);
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
  await benchPage();
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert.");
process.exit(failures ? 1 : 0);
