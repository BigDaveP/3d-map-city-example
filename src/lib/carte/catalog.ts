/**
 * Catalogue fictif de la carte opérationnelle : restaurants et livreurs à Québec et Montréal.
 * Les noms sont inventés ; les coordonnées tombent dans des quartiers réels pour que les
 * bâtiments 3D d'OpenStreetMap puissent masquer les panneaux.
 */
import { rand01 } from "../sim/random";

export type CityId = "mtl" | "qc";

export interface City {
  id: CityId;
  name: string;
  center: [number, number];
  zoom: number;
  bearing: number;
}

export const CITIES: Record<CityId, City> = {
  mtl: { id: "mtl", name: "Montréal", center: [-73.5685, 45.5005], zoom: 15.8, bearing: -20 },
  qc: { id: "qc", name: "Québec", center: [-71.2125, 46.8115], zoom: 15.6, bearing: 15 },
};

export interface Restaurant {
  id: string;
  idx: number;
  name: string;
  city: CityId;
  lng: number;
  lat: number;
  /** orientation de la façade (degrés, 0 = panneau face au sud) pour le mode « plaqué » */
  facade: number;
  /** commandes moyennes en attente (base de la simulation) */
  load: number;
}

const MTL: [number, number][] = [
  [-73.5772, 45.5048], [-73.5713, 45.5030], [-73.5690, 45.5032], [-73.5617, 45.5088], [-73.5545, 45.5075],
  [-73.5546, 45.5048], [-73.5600, 45.5020], [-73.5710, 45.4990], [-73.5760, 45.4975], [-73.5690, 45.5110],
  [-73.5770, 45.5150], [-73.5730, 45.5170], [-73.5835, 45.5185], [-73.5655, 45.5062], [-73.5620, 45.5035],
];
const QC: [number, number][] = [
  [-71.2054, 46.8125], [-71.2080, 46.8139], [-71.2110, 46.8150], [-71.2130, 46.8105], [-71.2180, 46.8075],
  [-71.2165, 46.8095], [-71.2050, 46.8165], [-71.2240, 46.8130], [-71.2250, 46.8155], [-71.2300, 46.8160],
  [-71.2210, 46.8115], [-71.2260, 46.8040], [-71.2275, 46.8125], [-71.2195, 46.8155], [-71.2310, 46.8180],
];

const KIND = ["Bistro", "Casse-croûte", "Brasserie", "Café", "Cantine", "Comptoir", "Trattoria", "Buvette"];
const STEM = [
  "Ardelune", "Brisanne", "Corvelac", "Daunir", "Esmerval", "Falounet", "Galvéra", "Hirondel", "Ivrelot", "Jasmoral",
  "Kervalis", "Lunessa", "Morvanne", "Nivéral", "Orbelin", "Pradoune", "Quintelle", "Rovanel", "Silvebrume", "Tarnelle",
  "Ulmière", "Valbrise", "Wendelin", "Yverdane", "Zéphirine", "Aubelac", "Bellerive", "Clairmont", "Doucelin", "Églantine",
];

export const RESTAURANTS: Restaurant[] = [...MTL.map((p) => ["mtl", p] as const), ...QC.map((p) => ["qc", p] as const)].map(([city, [lng, lat]], idx) => ({
  id: `R${String(idx + 1).padStart(2, "0")}`,
  idx,
  name: `${KIND[idx % KIND.length]} ${STEM[idx]}`,
  city,
  lng,
  lat,
  facade: Math.round(rand01("facade", idx) * 4) * 90 - 180 + 20,
  load: 2 + Math.floor(rand01("load", idx) * 7),
}));

export interface Courier {
  id: string;
  idx: number;
  name: string;
  city: CityId;
  /** boucle de livraison : restaurants visités (indices), parcourue en ligne droite */
  route: number[];
  /** vitesse (m/s) */
  speed: number;
  /** restaurant assigné par défaut */
  restaurant: number;
}

const FIRST = ["Alex", "Bea", "Chloé", "Dany", "Éloi", "Fanny", "Gab", "Hugo", "Inès", "Jo", "Karim", "Léa", "Malik", "Nora", "Oli", "Paz", "Rémi", "Sami", "Tess", "Ugo"];

export const COURIERS: Courier[] = Array.from({ length: 40 }, (_, idx) => {
  const city: CityId = idx < 24 ? "mtl" : "qc";
  const pool = RESTAURANTS.filter((r) => r.city === city);
  const n = 3 + Math.floor(rand01("rlen", idx) * 2);
  const route: number[] = [];
  for (let k = 0; k < n; k++) {
    let r = pool[Math.floor(rand01("route", idx, k) * pool.length)].idx;
    if (route.includes(r)) r = pool[(pool.findIndex((p) => p.idx === r) + k + 1) % pool.length].idx;
    route.push(r);
  }
  return {
    id: `L${String(idx + 1).padStart(2, "0")}`,
    idx,
    name: `${FIRST[idx % FIRST.length]} ${String.fromCharCode(65 + (idx % 26))}.`,
    city,
    route,
    speed: 4 + rand01("speed", idx) * 4,
    restaurant: route[0],
  };
});

export const restaurantsOf = (city: CityId) => RESTAURANTS.filter((r) => r.city === city);

/** Crédits incrustés sous la vidéo exportée de /carte : fond de carte (attribution du style) et données simulées. */
export const CARTE_VIDEO_CREDITS = [
  "Fond de carte : OpenFreeMap, OpenMapTiles, OpenStreetMap",
  "Données entièrement simulées : restaurants, livreurs et commandes sont fictifs",
] as const;
