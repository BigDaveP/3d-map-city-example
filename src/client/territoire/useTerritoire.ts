"use client";
/** Accès React à l'état commun de la ville : sélecteur, heure simulée et journée simulée. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { allAlerts, type Alert } from "@/lib/territoire/alerts";
import { dayStartOf } from "@/lib/territoire/day";
import { snowSource } from "@/lib/territoire/neige";
import { FORECAST_RETRY_MS, forecastOf, loadForecast, simNow, territoireStore, type TerritoireState } from "./store";

export function useTerritoire<T>(sel: (s: TerritoireState) => T): T {
  return useStore(territoireStore, sel);
}

/**
 * Heure simulée, rafraîchie toutes les `everyMs` ms, à chaque changement d'horloge et à chaque
 * décision : une action est datée à l'heure simulée exacte, plus tard que la dernière lecture ;
 * sans relecture, `actionsUpTo` l'ignorerait jusqu'au tic suivant.
 */
export function useSimNow(everyMs = 1000): number {
  const clock = useTerritoire((s) => s.clock);
  const actions = useTerritoire((s) => s.actions);
  const [t, setT] = useState(() => simNow());
  useEffect(() => {
    setT(simNow());
    const id = setInterval(() => setT(simNow()), everyMs);
    return () => clearInterval(id);
  }, [clock, actions, everyMs]);
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

const never = () => () => {};
/**
 * false au rendu serveur et pendant l'hydratation, true ensuite (et dès le premier rendu d'un
 * composant monté après l'hydratation, par exemple après une navigation côté client). Une vue rendue
 * par le serveur affiche ses valeurs jusque-là, puis celles du visiteur, sans écart d'hydratation.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}

/**
 * Effet de bord explicite : garde la prévision du store à jour tant que le composant est monté
 * (chargée au besoin, rafraîchie après 10 min, réessayée 30 s après un échec ; voir `loadForecast`).
 * Appelé une fois par page : par la scène de `/carte` et par l'accueil.
 */
export function useForecastRefresh(): void {
  useEffect(() => {
    void loadForecast();
    const id = setInterval(() => void loadForecast(), FORECAST_RETRY_MS);
    return () => clearInterval(id);
  }, []);
}

/** Prévision connue (null : indisponible ou en cours de chargement). Sans effet de bord. */
export function useForecast() {
  return useTerritoire(forecastOf);
}

/** Alertes de la ville à l'heure simulée, avec les actions du visiteur. Sans effet de bord. */
export function useLiveAlerts(): Alert[] {
  const t = useSimNow();
  const actions = useTerritoire((s) => s.actions);
  const forecast = useForecast();
  return allAlerts(t, actions, snowSource(forecast));
}
