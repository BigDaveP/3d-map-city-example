"use client";
/** Accès React au store de la démo réseau d'eau. */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { aqueducStore, simNow, type AqState } from "./store";

export function useAq<T>(sel: (s: AqState) => T): T {
  return useStore(aqueducStore, sel);
}

/** Heure simulée, rafraîchie toutes les `everyMs` ms (et à chaque changement d'horloge). */
export function useSimNow(everyMs = 1000): number {
  const clock = useAq((s) => s.clock);
  const [t, setT] = useState(() => simNow());
  useEffect(() => {
    setT(simNow());
    const id = setInterval(() => setT(simNow()), everyMs);
    return () => clearInterval(id);
  }, [clock, everyMs]);
  return t;
}
