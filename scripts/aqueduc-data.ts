// Télécharge le réseau d'aqueduc de Trois-Rivières (Données Québec) et écrit
// data/aqueduc/trois-rivieres.json (format compact RawNetwork) + SOURCE.md.
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Material, PipeClass, RawNetwork } from "../src/lib/aqueduc/network";

const URL_SOURCE =
  "https://www.donneesquebec.ca/recherche/dataset/7ad4ea4e-cfc5-417b-9eb8-6e7f379a8f6e/resource/d55f59ee-a9be-4f38-a78e-c13ebe3ca7b3/download/conduites-eau-potable-v3r.json";
const PAGE = "https://www.donneesquebec.ca/recherche/dataset/7ad4ea4e-cfc5-417b-9eb8-6e7f379a8f6e";
/** Début de la section de SOURCE.md qui n'est pas générée (sources des seuils). */
const SECTION_SEUILS = "## Seuils affichés";

const MATERIAUX: Record<string, Material> = {
  "Fonte grise": "fonte-grise",
  "Fonte ductile": "fonte-ductile",
  "Chlorure de polyvinyle": "pvc",
  PEHD: "pehd",
  "Ciment-amiante": "ciment-amiante",
};
const CLASSES: Record<string, PipeClass> = {
  Amenee: "amenee",
  Maitresse_A: "maitresse",
  Maitresse_D: "maitresse",
  Distribution: "distribution",
  "Branchement de BF": "branchement",
  "Branchement de service": "branchement",
  "Branchement de purge": "branchement",
};

interface Feature {
  geometry: { type: string; coordinates: number[][] } | null;
  properties: Record<string, unknown>;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "aqueduc-"));
  const fichier = join(dir, "conduites.json");
  const res = await fetch(URL_SOURCE);
  if (!res.ok) throw new Error(`Téléchargement impossible : HTTP ${res.status}`);
  writeFileSync(fichier, Buffer.from(await res.arrayBuffer()));
  // Données non fiables : simple analyse JSON, rien n'est exécuté.
  const geo = JSON.parse(readFileSync(fichier, "utf8")) as { features: Feature[] };

  const nodeIdx = new Map<string, number>();
  const nodes: string[] = [];
  const node = (id: string) => {
    let i = nodeIdx.get(id);
    if (i === undefined) {
      i = nodes.length;
      nodes.push(id);
      nodeIdx.set(id, i);
    }
    return i;
  };

  const segs: RawNetwork["segs"] = [];
  let ignores = 0;
  for (const f of geo.features) {
    const p = f.properties;
    const cls = CLASSES[String(p.CLASSE_FONCT)];
    if (!cls || !f.geometry || f.geometry.type !== "LineString") {
      ignores++;
      continue;
    }
    const coords: number[] = [];
    for (const [lng, lat] of f.geometry.coordinates) coords.push(+lng.toFixed(6), +lat.toFixed(6));
    const year = typeof p.INSTALLATION_YEAR === "number" ? p.INSTALLATION_YEAR : null;
    const longueur = Math.round(parseFloat(String(p.LENGTH__SCALED_)) * 10) / 10;
    segs.push([
      String(p.LABEL),
      node(String(p.START_NODE)),
      node(String(p.STOP_NODE)),
      Number(p.DIAMETER) || 0,
      MATERIAUX[String(p.MATERIAL)] ?? "autre",
      year,
      cls,
      Number.isFinite(longueur) ? longueur : 0,
      coords,
    ]);
  }

  const extractedAt = new Date().toISOString().slice(0, 10);
  const brut: RawNetwork = {
    v: 1,
    source: PAGE,
    license: "CC-BY 4.0",
    extractedAt,
    nodes,
    segs,
  };
  mkdirSync("data/aqueduc", { recursive: true });
  writeFileSync("data/aqueduc/trois-rivieres.json", JSON.stringify(brut));
  // la section des seuils (rédigée à la main) est conservée telle quelle
  let seuils = "";
  try {
    const avant = readFileSync("data/aqueduc/SOURCE.md", "utf8");
    const i = avant.indexOf(SECTION_SEUILS);
    if (i >= 0) seuils = "\n" + avant.slice(i);
  } catch {}
  writeFileSync(
    "data/aqueduc/SOURCE.md",
    `# Source des données d'aqueduc

Autres données de l'outil (zones de stationnement de nuit réelles, feux d'interdiction simulés) : [data/territoire/SOURCE.md](../territoire/SOURCE.md).

- **Jeu de données** : Conduites d'eau potable, Ville de Trois-Rivières
- **Page** : ${PAGE}
- **Fichier téléchargé** : ${URL_SOURCE}
- **Licence** : CC-BY 4.0 (attribution : « Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4.0 »)
- **Extraction** : ${extractedAt}, par \`npm run aqueduc:data\`
- **Champs conservés** : LABEL (identifiant du tronçon), START_NODE et STOP_NODE (nœuds), DIAMETER (mm), MATERIAL (normalisé en six valeurs), INSTALLATION_YEAR, CLASSE_FONCT (normalisée en quatre classes), LENGTH__SCALED_ (m), géométrie (WGS84, 6 décimales).
- **Écartés** : ${ignores} tronçons de classe « -Inconnu- » ; tous les autres champs.
- **Tronçons conservés** : ${segs.length}
${seuils}`,
  );
  console.log(`${segs.length} tronçons, ${nodes.length} nœuds, ${ignores} ignorés, ${(statSync("data/aqueduc/trois-rivieres.json").size / 1e6).toFixed(2)} Mo`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
