/**
 * Générateurs de données simulées.
 *
 * Les sources « polling » sont sans état côté serveur : la valeur d'une succursale au
 * tick T est une fonction pure de (succursale, dernier tick où elle a changé). Le client
 * envoie son numéro de tick, ce qui rend les réponses reproductibles (utile au banc).
 */
import { clamp, pick, rand01 } from "./random";
import type { Branch, Review, ReviewsState, SalesState, StaffState, StormChange, WeatherCondition, WeatherState } from "./types";
import { KINDS, WEATHER_CONDITIONS } from "./types";

/** Périodes nominales (ms, vitesse x1). */
export const PERIOD = {
  staff: 60_000,
  reviews: 15 * 60_000,
  weather: 60 * 60_000,
  salesMin: 1_000,
  salesMax: 5_000,
} as const;

/** Probabilité qu'une succursale change à un tick donné. */
const CHANGE_P = { staff: 0.35, reviews: 0.3, weather: 0.25 } as const;

/** Dernier tick <= `tick` auquel la source a changé pour cette succursale (0 = état initial). */
export function lastChangeTick(source: keyof typeof CHANGE_P, branchIdx: number, tick: number): number {
  for (let t = tick; t > 0; t--) {
    if (rand01(source, branchIdx, t) < CHANGE_P[source]) return t;
  }
  return 0;
}

// ---------------------------------------------------------------- personnel
export function staffAt(b: Branch, tick: number): StaffState {
  const t = lastChangeTick("staff", b.idx, tick);
  const scheduled = 6 + Math.floor(rand01("sched", b.idx) * 12);
  const r = rand01("staff", b.idx, t, "v");
  const vacancies = r < 0.62 ? 0 : r < 0.84 ? 1 : r < 0.95 ? 2 : 3;
  const late = Math.floor(Math.pow(rand01("staff", b.idx, t, "l"), 2.2) * 4);
  const absent = Math.floor(rand01("staff", b.idx, t, "a") * 2);
  const onDuty = Math.max(1, scheduled - vacancies - absent - late);
  return { scheduled, onDuty, late, vacancies };
}

// ---------------------------------------------------------------- avis
const AUTHORS = ["Camille R.", "Noé B.", "Lina T.", "Sacha M.", "Yanis P.", "Maëlle D.", "Rémi G.", "Zoé L.", "Anouk F.", "Théo V."];
const POSITIVE = [
  "Accueil chaleureux, rayons bien tenus.",
  "Rapide et efficace, rien à redire.",
  "Personnel aux petits soins, je reviendrai.",
  "Très bon conseil en caisse.",
  "Magasin propre et lumineux.",
];
const NEUTRAL = [
  "Correct, mais un peu d'attente.",
  "Bon choix, prix un peu élevés.",
  "Rien d'exceptionnel, service honnête.",
];
const NEGATIVE = [
  "Une seule caisse ouverte, 20 minutes d'attente.",
  "Produit introuvable et personne pour aider.",
  "Accueil froid, je suis reparti sans rien.",
  "Rayon frais en rupture tout l'après-midi.",
];

function reviewFor(seed: string | number, branchIdx: number, t: number, stars: number): Review {
  const pool = stars >= 4 ? POSITIVE : stars === 3 ? NEUTRAL : NEGATIVE;
  return {
    author: pick(AUTHORS, rand01(seed, branchIdx, t, "author")),
    stars,
    text: pick(pool, rand01(seed, branchIdx, t, "text")),
  };
}

export function reviewsAt(b: Branch, tick: number): ReviewsState {
  const t = lastChangeTick("reviews", b.idx, tick);
  const base = 3.2 + rand01("rbase", b.idx) * 1.6;
  const rating = clamp(Math.round((base + (rand01("reviews", b.idx, t) - 0.55) * 1.2) * 10) / 10, 1, 5);
  const stars = clamp(Math.round(rating + (rand01("reviews", b.idx, t, "s") - 0.5) * 2), 1, 5);
  const count = 40 + Math.floor(rand01("rcount", b.idx) * 400) + Math.floor(tick * CHANGE_P.reviews);
  return { rating, count, last: reviewFor("reviews", b.idx, t, stars) };
}

// ---------------------------------------------------------------- météo
const BASE_TEMP = [11, 7, 15, 4, 18];

export function weatherAt(b: Branch, tick: number): WeatherState {
  const t = lastChangeTick("weather", b.idx, tick);
  // la météo est corrélée par région : on mélange un tirage régional et un tirage local
  const regional = rand01("wreg", b.regionIdx, Math.floor(t / 2));
  const local = rand01("weather", b.idx, t);
  const r = regional * 0.7 + local * 0.3;
  const condition: WeatherCondition = r < 0.38 ? "soleil" : r < 0.62 ? "nuages" : r < 0.8 ? "pluie" : r < 0.88 ? "brouillard" : r < 0.94 ? "neige" : "orage";
  const cold = condition === "neige" ? -8 : 0;
  const temp = Math.round(BASE_TEMP[b.regionIdx] + cold + (local - 0.5) * 10);
  return { condition, temp };
}

// ---------------------------------------------------------------- ventes
/** Montant moyen attendu d'un évènement de vente : sert de référence au rythme. */
export const salesBaseline = (b: Branch) => b.basket * 3.5;

export function initialSales(b: Branch): SalesState {
  const progress = 0.35 + rand01("sprog", b.idx) * 0.3;
  const revenue = Math.round(b.target * progress);
  return {
    revenue,
    transactions: Math.round(revenue / b.basket),
    pace: 0.8 + rand01("space", b.idx) * 0.35,
    updatedAt: 0,
  };
}

/** Lissage exponentiel du rythme de ventes. */
export function nextPace(prev: number, amount: number, baseline: number): number {
  const ratio = clamp(amount / baseline, 0, 3);
  return prev * 0.85 + ratio * 0.15;
}

/**
 * État par connexion SSE : chaque succursale a sa prochaine échéance et un facteur de
 * « creux » qui dérive lentement (certaines succursales passent en attention / critique).
 */
export class SalesSimulator {
  private next: Float64Array;
  private slump: Float32Array;
  private rnd: () => number;
  constructor(private branches: Branch[], private speed: number, seed: number, now: number) {
    let s = seed >>> 0;
    this.rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this.next = new Float64Array(branches.length);
    this.slump = new Float32Array(branches.length);
    for (let i = 0; i < branches.length; i++) {
      this.next[i] = now + this.interval() * this.rnd();
      this.slump[i] = rand01("slump0", i) < 0.12 ? 0.45 + this.rnd() * 0.3 : 1;
    }
  }
  private interval() {
    return (PERIOD.salesMin + this.rnd() * (PERIOD.salesMax - PERIOD.salesMin)) / this.speed;
  }
  /** Renvoie les évènements dus à l'instant `now`. */
  tick(now: number): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let i = 0; i < this.branches.length; i++) {
      if (this.next[i] > now) continue;
      this.next[i] = now + this.interval();
      // dérive du creux : la plupart des succursales reviennent vers 1
      if (this.rnd() < 0.02) this.slump[i] = 0.45 + this.rnd() * 0.3;
      else this.slump[i] += (1 - this.slump[i]) * 0.03;
      const b = this.branches[i];
      const tx = 1 + Math.floor(this.rnd() * 6 * this.slump[i]);
      const amount = Math.round(tx * b.basket * (0.6 + this.rnd() * 0.8) * (0.4 + 0.6 * this.slump[i]) * 100) / 100;
      out.push([i, amount, tx]);
    }
    return out;
  }
}

// ---------------------------------------------------------------- tempête
/** Fait changer `ratio` des cartes d'un coup, avec des valeurs franchement dégradées. */
export function stormChanges(branches: Branch[], seed: number, ratio = 0.3): StormChange[] {
  const total = branches.length * KINDS.length;
  const out: StormChange[] = [];
  for (let card = 0; card < total; card++) {
    if (rand01("storm", seed, card) >= ratio) continue;
    const b = branches[Math.floor(card / KINDS.length)];
    const kind = KINDS[card % KINDS.length];
    const r = rand01("stormv", seed, card);
    switch (kind) {
      case "sales":
        out.push({ card, kind, patch: { pace: 0.3 + r * 0.35, refund: Math.round(b.basket * (5 + r * 20)) } });
        break;
      case "staff":
        out.push({ card, kind, patch: { late: 2 + Math.floor(r * 3), vacancies: 2 + Math.floor(r * 2) } });
        break;
      case "reviews":
        out.push({ card, kind, patch: { ratingDelta: -(0.6 + r), last: reviewFor("storm", b.idx, seed, 1 + Math.floor(r * 2)) } });
        break;
      case "weather":
        out.push({ card, kind, patch: { condition: r < 0.7 ? "orage" : "neige", temp: r < 0.7 ? 9 + Math.round(r * 8) : -4 - Math.round(r * 5) } });
        break;
      case "alerts":
        out.push({ card, kind, patch: { message: pick(["Coupure réseau caisses", "Livraison retardée", "Panne chambre froide", "Afflux client imprévu"], r) } });
        break;
    }
  }
  return out;
}

export const WEATHER_ICON: Record<WeatherCondition, string> = {
  soleil: "☀️",
  nuages: "☁️",
  pluie: "🌧️",
  brouillard: "🌫️",
  neige: "❄️",
  orage: "⛈️",
};
export { WEATHER_CONDITIONS };
