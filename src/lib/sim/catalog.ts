/** Catalogue fictif : régions, succursales, responsables. Entièrement inventé. */
import { hash, rand01 } from "./random";
import type { Branch, Manager, Region } from "./types";
import { KINDS } from "./types";

export const REGIONS: Region[] = [
  { id: "R1", idx: 0, name: "Région Aster" },
  { id: "R2", idx: 1, name: "Région Boréa" },
  { id: "R3", idx: 2, name: "Région Cendre" },
  { id: "R4", idx: 3, name: "Région Doline" },
  { id: "R5", idx: 4, name: "Région Ébène" },
];

const STEMS = [
  "Ardelune", "Brisanne", "Corvelac", "Daunir", "Esmerval", "Falounet", "Galvéra", "Hirondel",
  "Ivrelot", "Jasmoral", "Kervalis", "Lunessa", "Morvanne", "Nivéral", "Orbelin", "Pradoune",
  "Quintelle", "Rovanel", "Silvebrume", "Tarnelle",
];
const SUFFIXES = [
  "", "-sur-Orme", "-le-Haut", "-les-Saules", "-en-Brume", "-la-Claire", "-du-Lac", "-Saint-Ivre", "-aux-Pins", "-la-Neuve",
];

export const MANAGERS: Manager[] = [
  "Alix Morand", "Bastien Lequai", "Céleste Varin", "Dorian Faucher", "Elsa Guivarch", "Fabio Renard",
  "Gaëlle Tissot", "Hugo Peyrol", "Inès Caradec", "Jules Mabire", "Katia Delorme", "Lucien Arbogast",
].map((name, i) => ({ id: i + 1, name }));

const cache = new Map<number, Branch[]>();

/** Génère `cardCount / 5` succursales réparties équitablement entre les 5 régions. */
export function getBranches(cardCount: number): Branch[] {
  const nb = Math.floor(cardCount / KINDS.length);
  const hit = cache.get(nb);
  if (hit) return hit;
  const perRegion = Math.ceil(nb / REGIONS.length);
  const out: Branch[] = [];
  for (let i = 0; i < nb; i++) {
    const regionIdx = Math.floor(i / perRegion);
    const stem = STEMS[i % STEMS.length];
    const suffix = SUFFIXES[Math.floor(i / STEMS.length) % SUFFIXES.length];
    // au-delà de 200 succursales (extrapolation), on numérote : « Ardelune 2 »
    const round = Math.floor(i / (STEMS.length * SUFFIXES.length));
    const basket = 18 + Math.round(rand01("basket", i) * 60);
    out.push({
      id: `S${String(i + 1).padStart(3, "0")}`,
      idx: i,
      name: stem + suffix + (round ? ` ${round + 1}` : ""),
      regionId: REGIONS[regionIdx].id,
      regionIdx,
      basket,
      target: Math.round((6000 + rand01("target", i) * 34000) / 100) * 100,
    });
  }
  cache.set(nb, out);
  return out;
}

export const branchSeed = (b: Branch) => hash("branch", b.idx);
