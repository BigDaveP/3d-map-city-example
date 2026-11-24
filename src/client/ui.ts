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
}));
