/**
 * Vignettes des environnements (accueil, sélecteur) : vraies captures de la scène 3D, sans
 * l'interface, écrites dans public/territoire/mini-{env}.webp (voir src/lib/territoire/thumbs.ts).
 *
 *   npm run build && npx next start -p 3300 &
 *   BASE_URL=http://localhost:3300 npm run thumbs:territoire
 *
 * - Aqueduc : caméra de départ en mode HTML-in-Canvas, horloge épinglée à 12:00 de la journée de
 *   référence (secteurs et étiquettes de capteurs dessinés dans la scène).
 * - Déneigement : 23:30, décision par défaut (les trois zones en vigueur), feux allumés, capturés dans
 *   la phase haute du clignotement.
 * - Collecte, Zonage, Évaluation (lot 2) : le fond de carte de leur secteur, sans couche ni marquage,
 *   désaturé. La mention « À venir » est dans la carte de l'accueil, pas dans l'image.
 *
 * L'horloge est épinglée par `window.__territoire.store` ; la barre, le panneau, le sélecteur, la frise
 * et les commandes de la carte sont masqués pendant la capture. Fenêtre de 1440 × 600, réduite à
 * 1152 × 480 (2× la vignette de l'accueil) et encodée en WebP par le Chromium de Playwright, qualité
 * abaissée jusqu'à passer sous 120 Ko. Aucune dépendance de plus. Environnement sans GPU (SwiftShader).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import { SCENARIO_DAY } from "../src/lib/aqueduc/scenario";
import { atHour } from "../src/lib/territoire/day";
import type { EnvId } from "../src/lib/territoire/envs";
import { THUMBS } from "../src/lib/territoire/thumbs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = new URL("../public/territoire/", import.meta.url);
const VIEW = { width: 1440, height: 600 };
const MAX_BYTES = 120 * 1024;

/** Interface masquée : seule la carte reste (la carte se redimensionne seule). */
const HIDE_SHELL = `
  .aq-bar, .aq-noapi, .tr-envpanel, .tr-switcher, .aq-timeline, .aq-inspector, .aq-story, .aq-perf,
  .aq-loading, .maplibregl-control-container, nextjs-portal { display: none !important; }
`;

type Camera = { center: [number, number]; zoom: number; pitch: number; bearing: number };

/** Secteurs du lot 2 : une partie de la ville chacun (fond de carte seul). */
const BASE_CAMERAS: Record<"collecte" | "zonage" | "evaluation", Camera> = {
  // quartiers résidentiels de Trois-Rivières-Ouest
  collecte: { center: [-72.596, 46.336], zoom: 14.6, pitch: 50, bearing: -20 },
  // centre-ville, vue plus haute que celle de l'aqueduc
  zonage: { center: [-72.5436, 46.3446], zoom: 14.4, pitch: 45, bearing: -25 },
  // Cap-de-la-Madeleine, lots et bâtiments
  evaluation: { center: [-72.522, 46.366], zoom: 15, pitch: 55, bearing: 15 },
};

async function setClock(p: Page, at: number) {
  await p.waitForFunction(() => (window as any).__territoire?.store, null, { timeout: 45_000 });
  await p.evaluate((t) => (window as any).__territoire.store.setState({ clock: { t0: t, speed: 1, startedAt: Date.now() } }), at);
}

/**
 * La carte a fini de charger ses tuiles et de dessiner (événement `idle`), 15 s au plus. Fonction en
 * texte : tsx ajouterait `__name` aux fonctions nommées, inconnu dans la page.
 */
async function idle(p: Page) {
  await p.evaluate(`new Promise((resolve) => {
    const map = window.__territoire && window.__territoire.map;
    if (!map) return resolve();
    map.once("idle", resolve);
    map.triggerRepaint();
    setTimeout(resolve, 15000);
  })`);
}

/** Capture de la fenêtre, réduite à la taille du fichier et encodée en WebP sous 120 Ko. */
async function encode(b: Browser, png: Buffer, gray: boolean): Promise<Buffer> {
  const { width, height } = THUMBS.aqueduc;
  const p = await b.newPage();
  const out = await p.evaluate(
    async ({ src, width, height, gray, max }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      if (gray) ctx.filter = "grayscale(1) contrast(1.08)";
      ctx.drawImage(img, 0, 0, width, height);
      let url = "";
      for (let q = 0.86; q >= 0.4; q -= 0.06) {
        url = c.toDataURL("image/webp", q);
        if ((url.length - "data:image/webp;base64,".length) * 0.75 < max) break;
      }
      return url;
    },
    { src: `data:image/png;base64,${png.toString("base64")}`, width, height, gray, max: MAX_BYTES },
  );
  await p.close();
  if (!out.startsWith("data:image/webp")) throw new Error("ce Chromium n'encode pas le WebP");
  return Buffer.from(out.split(",")[1], "base64");
}

async function open(b: Browser, path: string) {
  const ctx = await b.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}${path}`);
  await p.waitForFunction(() => (window as any).__territoire?.map, null, { timeout: 45_000 });
  await p.addStyleTag({ content: HIDE_SHELL });
  return { ctx, p };
}

async function save(env: EnvId, buf: Buffer) {
  const file = new URL(THUMBS[env].src.replace("/territoire/", ""), OUT);
  await writeFile(file, buf);
  console.log(`${env.padEnd(12)} ${(buf.length / 1024).toFixed(1).padStart(6)} Ko  ${file.pathname}`);
  if (buf.length >= MAX_BYTES) throw new Error(`${env} : ${buf.length} octets (≥ 120 Ko)`);
}

async function aqueduc(b: Browser) {
  const { ctx, p } = await open(b, "/carte/aqueduc?mode=hic");
  await setClock(p, atHour(SCENARIO_DAY, "12:00"));
  const ok = await p
    .waitForFunction(() => {
      const w = window as any;
      const panels = [...(w.__hicMap?.layer?.panels.values() ?? [])];
      return w.__territoire.store.getState().mode === "hic" && panels.length > 0 && panels.every((q: any) => q.tex);
    }, null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) throw new Error("aqueduc : HTML-in-Canvas inactif ou surfaces non capturées");
  await idle(p);
  await p.waitForTimeout(2500);
  await save("aqueduc", await encode(b, await p.screenshot(), false));
  await ctx.close();
}

async function deneigement(b: Browser) {
  const { ctx, p } = await open(b, "/carte/deneigement?mode=hic");
  await p.waitForFunction(() => (window as any).__territoire?.snow, null, { timeout: 45_000 });
  await setClock(p, atHour(SCENARIO_DAY, "23:30"));
  await p.waitForFunction(() => {
    const w = window as any;
    const L = w.__hicMap?.layer;
    const plans = w.__territoire.snow.plans() as { ban: string }[];
    return L && ["zone:A", "zone:B", "zone:C"].every((k) => L.panels.get(k)?.tex) && plans.every((x) => x.ban === "en-vigueur");
  }, null, { timeout: 30_000 });
  await idle(p);
  await p.waitForTimeout(2000);
  // phase haute du clignotement des feux allumés (opacité 1), repérée à son début
  await p.waitForFunction(() => {
    const w = window as any;
    const cur = w.__territoire.map.getPaintProperty("dn-lights", "circle-opacity")?.[2];
    const fresh = cur === 1 && w.__thumbPhase !== 1;
    w.__thumbPhase = cur;
    return fresh;
  }, null, { timeout: 5_000, polling: 30 });
  await p.waitForTimeout(120);
  await save("deneigement", await encode(b, await p.screenshot(), false));
  await ctx.close();
}

async function lot2(b: Browser) {
  const { ctx, p } = await open(b, "/carte/deneigement?mode=classic");
  await p.waitForFunction(() => (window as any).__territoire?.snow, null, { timeout: 45_000 });
  await p.addStyleTag({ content: ".maplibregl-marker { display: none !important; }" });
  await p.evaluate(() => {
    const map = (window as any).__territoire.map;
    for (const l of map.getStyle().layers) if (l.id.startsWith("dn-") || l.id.startsWith("aq-")) map.setLayoutProperty(l.id, "visibility", "none");
  });
  for (const env of ["collecte", "zonage", "evaluation"] as const) {
    await p.evaluate((cam) => (window as any).__territoire.map.jumpTo(cam), BASE_CAMERAS[env]);
    await idle(p);
    await p.waitForTimeout(1500);
    await save(env, await encode(b, await p.screenshot(), true));
  }
  await ctx.close();
}

await mkdir(OUT, { recursive: true });
const b = await chromium.launch();
try {
  await aqueduc(b);
  await deneigement(b);
  await lot2(b);
} finally {
  await b.close();
}
