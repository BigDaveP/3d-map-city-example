import { createStore } from "zustand";

export type Mode = "dom" | "canvas";
export type ApiState = "absente" | "détectée" | "active";

export interface UiState {
  mode: Mode;
  speed: 1 | 10 | 100;
  maxCaptures: number;
  maxMs: number;
  atlas: boolean;
  api: ApiState;
  apiDetail: string;
  /** Raison du dernier repli automatique vers le mode DOM. */
  fallback: string;
  robotOpen: boolean;
  level: 0 | 1 | 2;
  /** cartes épinglées : affichées en panneau complet dès le niveau intermédiaire */
  pinned: number[];
}

export const uiStore = createStore<UiState>()(() => ({
  mode: "dom",
  speed: 1,
  maxCaptures: 12,
  maxMs: 6,
  atlas: true,
  api: "absente",
  apiDetail: "",
  fallback: "",
  robotOpen: false,
  level: 0,
  pinned: [],
}));

export function togglePin(card: number) {
  const p = uiStore.getState().pinned;
  uiStore.setState({ pinned: p.includes(card) ? p.filter((c) => c !== card) : [...p, card] });
}

/** Niveau effectif d'une carte. */
export const cardLevel = (level: 0 | 1 | 2, pinned: readonly number[], card: number): 0 | 1 | 2 => (level > 0 && pinned.includes(card) ? 2 : level);
