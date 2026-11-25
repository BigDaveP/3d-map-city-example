"use client";
/** Accès React à l'état commun de la ville : sélecteur, heure simulée et journée simulée. */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { dayStartOf } from "@/lib/territoire/day";
import { simNow, territoireStore, type TerritoireState } from "./store";

export function useTerritoire<T>(sel: (s: TerritoireState) => T): T {
  return useStore(territoireStore, sel);
}

/** Heure simulée, rafraîchie toutes les `everyMs` ms (et à chaque changement d'horloge). */
export function useSimNow(everyMs = 1000): number {
  const clock = useTerritoire((s) => s.clock);
  const [t, setT] = useState(() => simNow());
  useEffect(() => {
    setT(simNow());
    const id = setInterval(() => setT(simNow()), everyMs);
    return () => clearInterval(id);
  }, [clock, everyMs]);
  return t;
}

/** Minuit local de la journée simulée : ne fait rendre le composant qu'au changement de journée. */
export function useSimDay(): number {
  const clock = useTerritoire((s) => s.clock);
  const [day, setDay] = useState(() => dayStartOf(simNow()));
  useEffect(() => {
    const tick = () => setDay(dayStartOf(simNow()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [clock]);
  return day;
}
