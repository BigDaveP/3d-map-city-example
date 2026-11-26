"use client";
/** Accès React au store de la démo réseau d'eau (l'horloge et le mode sont dans `territoire/useTerritoire`). */
import { useStore } from "zustand";
import { aqueducStore, type AqState } from "./store";

export function useAq<T>(sel: (s: AqState) => T): T {
  return useStore(aqueducStore, sel);
}
