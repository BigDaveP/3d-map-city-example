// Télécharge les zones de stationnement de nuit (Données Québec), génère les feux d'interdiction
// simulés sur les nœuds des conduites principales, et écrit data/territoire/*.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodeNetwork, type RawNetwork } from "../src/lib/aqueduc/network";
import type { ZoneId } from "../src/lib/territoire/day";
import { distanceM, pointInPolygon, type Polygon } from "../src/lib/territoire/geo";

const URL_SOURCE =
  "https://www.donneesquebec.ca/recherche/dataset/63037f5c-f592-4538-89b2-8a850e758b97/resource/2fcc9586-1ac7-4501-a310-ad2e7c2bf5c4/download/stationnement-nuit-v3r.json";
const PAGE = "https://www.donneesquebec.ca/recherche/dataset/63037f5c-f592-4538-89b2-8a850e758b97";
const ESPACEMENT_M = 250;
const ESPACEMENT_DISTRIBUTION_M = 400;
const MIN_FEUX = 20;
const MAX_FEUX = 200;

interface Feature {
  geometry: { type: string; coordinates: number[][][] };
  properties: { V_DetailZone?: string };
}

const arrondi = (v: number) => +v.toFixed(5);

/** Garde chaque point à plus de `espace` m de tous les points déjà gardés, dans l'ordre reçu. */
function espacer(candidats: [number, number][], gardes: [number, number][], espace: number): void {
  for (const p of candidats) if (gardes.every((q) => distanceM(p, q) > espace)) gardes.push(p);
}

async function main() {
  const res = await fetch(URL_SOURCE);
  if (!res.ok) throw new Error(`Téléchargement impossible : HTTP ${res.status}`);
  // Données non fiables : simple analyse JSON, rien n'est exécuté.
  const geo = JSON.parse(await res.text()) as { features: Feature[] };

  const zones = geo.features
    .map((f) => {
      const m = /^Zone ([ABC])$/.exec(f.properties.V_DetailZone ?? "");
      if (!m || f.geometry.type !== "Polygon") throw new Error(`Entité inattendue : ${JSON.stringify(f.properties)}`);
      const polygon = f.geometry.coordinates.map((ring) => ring.map(([x, y]) => [arrondi(x), arrondi(y)] as [number, number]));
      return { id: m[1] as ZoneId, name: `Zone ${m[1]}`, polygon: polygon as Polygon };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (zones.map((z) => z.id).join("") !== "ABC") throw new Error("Les zones A, B et C sont attendues");

  const net = decodeNetwork(JSON.parse(readFileSync("data/aqueduc/trois-rivieres.json", "utf8")) as RawNetwork);
  // position d'un nœud : premier ou dernier sommet d'un segment qui y touche ; ordre du réseau, donc déterministe
  const pos = (cls: string[]) => {
    const out: [number, number][] = [];
    const vu = new Set<number>();
    for (const s of net.segments) {
      if (!cls.includes(s.cls)) continue;
      const c = s.coords;
      for (const [n, k] of [[s.a, 0], [s.b, c.length - 2]] as const) {
        if (vu.has(n)) continue;
        vu.add(n);
        out.push([arrondi(c[k]), arrondi(c[k + 1])]);
      }
    }
    return out;
  };
  const principaux = pos(["amenee", "maitresse"]);
  const distribution = pos(["distribution"]);

  const lights: { id: string; zone: ZoneId; at: [number, number] }[] = [];
  const bilan: string[] = [];
  const espaces: string[] = [];
  for (const z of zones) {
    const dedans = (p: [number, number]) => pointInPolygon(p, z.polygon);
    const candidats = principaux.filter(dedans);
    // zone trop dense (la C) : on écarte les feux par pas de 50 m jusqu'à tenir sous le plafond
    let espace = ESPACEMENT_M;
    let gardes: [number, number][] = [];
    for (; ; espace += 50) {
      gardes = [];
      espacer(candidats, gardes, espace);
      if (gardes.length <= MAX_FEUX) break;
    }
    espaces.push(`${z.id} ${espace} m`);
    const parPrincipales = gardes.length;
    if (gardes.length < MIN_FEUX) espacer(distribution.filter(dedans), gardes, ESPACEMENT_DISTRIBUTION_M);
    if (gardes.length < MIN_FEUX || gardes.length > MAX_FEUX) throw new Error(`Zone ${z.id} : ${gardes.length} feux, hors de ${MIN_FEUX}-${MAX_FEUX}`);
    gardes.forEach((at, i) => lights.push({ id: `F-${z.id}-${String(i + 1).padStart(3, "0")}`, zone: z.id, at }));
    bilan.push(`${z.id} : ${gardes.length} feux (${parPrincipales} sur les conduites principales)`);
  }

  const extractedAt = new Date().toISOString().slice(0, 10);
  mkdirSync("data/territoire", { recursive: true });
  writeFileSync("data/territoire/stationnement-nuit.json", JSON.stringify({ zones, extractedAt }));
  writeFileSync("data/territoire/feux.json", JSON.stringify({ lights }));
  writeFileSync(
    "data/territoire/SOURCE.md",
    `# Source des données du territoire

## Zones de stationnement de nuit (réelles)

- **Jeu de données** : Stationnement de nuit, Ville de Trois-Rivières
- **Page** : ${PAGE}
- **Fichier téléchargé** : ${URL_SOURCE}
- **Licence** : CC-BY 4.0 (attribution : « Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0 »)
- **Extraction** : ${extractedAt}, par \`npm run territoire:data\`
- **Champs conservés** : V_DetailZone (« Zone A », « Zone B », « Zone C »), géométrie (WGS84, arrondie à 5 décimales). Tous les autres champs sont écartés.

## Feux d'interdiction (simulés)

Feux d'interdiction : simulation inspirée du système de la Ville de Québec ; Trois-Rivières n'en a pas à notre connaissance.

- **Génération** : nœuds des conduites d'amenée et maîtresses du réseau d'aqueduc (\`data/aqueduc/trois-rivieres.json\`) situés dans chaque zone, gardés seulement à plus de ${ESPACEMENT_M} m des feux déjà gardés ; l'écart minimal monte par pas de 50 m dans une zone qui dépasserait ${MAX_FEUX} feux (écart retenu : ${espaces.join(", ")}). Les grandes rues suivent les conduites maîtresses.
- **Complément** : si une zone a moins de ${MIN_FEUX} feux, nœuds de distribution à plus de ${ESPACEMENT_DISTRIBUTION_M} m des feux déjà gardés.
- **Résultat** : ${bilan.join(" ; ")}.
- Les positions sont simulées : elles ne correspondent à aucun équipement réel.
`,
  );
  console.log(bilan.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
