/**
 * Vignettes des environnements : captures de la scène 3D (accueil et sélecteur), produites par
 * `npm run thumbs:territoire` (scripts/territoire-thumbs.ts) dans public/territoire. Lot 1 : la vue
 * de l'environnement dans un état réel de la journée ; lot 2 : le fond de carte de son secteur,
 * désaturé (la mention « À venir » est dans la carte, pas dans l'image). Module pur.
 */
import type { EnvId } from "./envs";

export interface Thumb {
  src: string;
  /** dimensions du fichier (2× la taille affichée sur l'accueil) */
  width: number;
  height: number;
  alt: string;
  /** légende courte : ce que montre la capture, un seul chiffre (lot 1), sinon null */
  caption: string | null;
}

/** Feux d'interdiction simulés (data/territoire/feux.json) et tronçons réels (data/aqueduc). */
export const LIGHTS_TOTAL = 427;
export const SEGMENTS_TOTAL = 24137;

const nf = (n: number) => n.toLocaleString("fr-CA");
const W = 1152;
const H = 480;

export const THUMBS: Record<EnvId, Thumb> = {
  aqueduc: {
    src: "/territoire/mini-aqueduc.webp",
    width: W,
    height: H,
    alt: "Vue 3D du centre-ville à 12 h : conduites colorées selon la pression, étiquettes des capteurs et marquage du secteur dans la scène",
    caption: `Tracé réel de ${nf(SEGMENTS_TOTAL)} tronçons`,
  },
  deneigement: {
    src: "/territoire/mini-deneigement.webp",
    width: W,
    height: H,
    alt: "Vue 3D de la ville à 23 h 30 : les trois zones de stationnement de nuit en vigueur, feux d'interdiction allumés",
    caption: `${nf(LIGHTS_TOTAL)} feux allumés à 23 h 30 (simulé)`,
  },
  collecte: { src: "/territoire/mini-collecte.webp", width: W, height: H, alt: "Fond de carte de la ville, en gris", caption: null },
  zonage: { src: "/territoire/mini-zonage.webp", width: W, height: H, alt: "Fond de carte du centre-ville, en gris", caption: null },
  evaluation: { src: "/territoire/mini-evaluation.webp", width: W, height: H, alt: "Fond de carte d'un quartier résidentiel, en gris", caption: null },
};
