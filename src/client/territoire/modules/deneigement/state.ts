/**
 * État propre au déneigement (hors React pour la carte, hooks pour l'interface) : élément
 * sélectionné (zone ou ressource) et plan des zones à l'heure simulée. Le plan vient du modèle pur
 * (`snowPlan`) ; les libellés sont dans `labels.ts`.
 */
import { useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ZoneId } from "@/lib/territoire/day";
import { snowPlan, snowSource, ZONES, type SnowSource, type ZonePlan } from "@/lib/territoire/neige";
import { forecastOf, simNow, territoireStore } from "../../store";
import { useForecast, useSimNow, useTerritoire } from "../../useTerritoire";

/**
 * Cadrage de l'environnement : les trois zones couvrent la ville, vue large et inclinée ; les trois
 * marquages tiennent entre le panneau (à gauche) et la fiche (à droite) à 1440 px de large.
 */
export const SNOW_CAMERA = { center: [-72.614, 46.348] as [number, number], zoom: 11.4, pitch: 40, bearing: -15 };

export type SnowSelection = { kind: "zone"; id: ZoneId } | { kind: "resource"; id: string } | null;

export const snowStore = createStore<{ selection: SnowSelection }>()(() => ({ selection: null }));

export const selectSnow = (selection: SnowSelection) => snowStore.setState({ selection });

export function useSnowSelection(): SnowSelection {
  return useStore(snowStore, (s) => s.selection);
}

export const isZoneId = (s: string): s is ZoneId => (ZONES as readonly string[]).includes(s);

/** Source de la neige et plan des zones, maintenant (carte, pilotage). */
export function currentSnow(): { source: SnowSource; plans: ZonePlan[] } {
  const s = territoireStore.getState();
  const source = snowSource(forecastOf(s));
  return { source, plans: snowPlan(simNow(), s.actions, source) };
}

/** Source de la neige et plan des zones à l'heure simulée, recalculés chaque seconde (interface). */
export function useSnowPlans(): { t: number; source: SnowSource; plans: ZonePlan[] } {
  const t = useSimNow();
  const actions = useTerritoire((s) => s.actions);
  const forecast = useForecast();
  const source = useMemo(() => snowSource(forecast), [forecast]);
  return { t, source, plans: snowPlan(t, actions, source) };
}
