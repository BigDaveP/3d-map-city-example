export const KINDS = ["sales", "staff", "reviews", "weather", "alerts"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  sales: "Ventes",
  staff: "Personnel",
  reviews: "Satisfaction",
  weather: "Météo",
  alerts: "Alertes",
};

/** 0 = ok, 1 = attention, 2 = critique */
export type Status = 0 | 1 | 2;
export const STATUS_LABEL = ["ok", "attention", "critique"] as const;

export interface Region {
  id: string;
  idx: number;
  name: string;
}

export interface Branch {
  id: string;
  idx: number;
  name: string;
  regionId: string;
  regionIdx: number;
  /** Panier moyen de référence (€) : sert de base au rythme des ventes. */
  basket: number;
  /** Objectif de CA du jour (€). */
  target: number;
}

export interface SalesState {
  revenue: number;
  transactions: number;
  /** Rythme lissé : 1 = normal. */
  pace: number;
  /** Rythme minimum toléré avant attention (variabilité par succursale). */
  updatedAt: number;
}

export interface StaffState {
  scheduled: number;
  onDuty: number;
  late: number;
  vacancies: number;
}

export interface Review {
  author: string;
  stars: number;
  text: string;
}

export interface ReviewsState {
  rating: number;
  count: number;
  last: Review;
}

export const WEATHER_CONDITIONS = ["soleil", "nuages", "pluie", "brouillard", "neige", "orage"] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

export interface WeatherState {
  condition: WeatherCondition;
  temp: number;
}

export interface Alert {
  id: string;
  branchId: string;
  kind: Kind;
  level: 1 | 2;
  message: string;
  createdAt: string;
  source: "auto" | "manuelle" | "tempête";
}

export interface Manager {
  id: number;
  name: string;
}

/** Évènement de vente diffusé par SSE : [indexSuccursale, montant €, transactions] */
export type SalesEvent = [number, number, number];

export interface StormChange {
  card: number; // index de carte (branche * 5 + kind)
  kind: Kind;
  patch: Record<string, unknown>;
}

export const cardIndex = (branchIdx: number, kindIdx: number) => branchIdx * KINDS.length + kindIdx;
export const cardId = (branchId: string, kind: Kind) => `${branchId}:${kind}`;
export const VALID_CARD_COUNTS = [250, 500, 1000] as const;
export function normalizeCardCount(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1000;
  // multiple de 25 (5 régions x 5 indicateurs), entre 25 et 1000
  return Math.max(25, Math.min(1000, Math.round(v / 25) * 25));
}
