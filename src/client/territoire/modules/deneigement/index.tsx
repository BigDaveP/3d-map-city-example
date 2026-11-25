"use client";
/**
 * Environnement Déneigement, version minimale (en attendant ses couches, sa scène et ses opérations) :
 * cadrage sur les trois zones de stationnement de nuit et panneau à son nom. Il remplit déjà
 * l'interface de module. En attendant la sélection des zones et des ressources (tâche 8), le focus
 * qui le vise (recherche « Zone A », « CH-01 ») est consommé dès qu'il arrive, pour ne pas traîner.
 */
import { ZONES_ATTRIBUTION } from "@/lib/territoire/about";
import { EnvPanel } from "../../shell/EnvPanel";
import { setFocus, territoireStore, type Focus } from "../../store";
import type { EnvModule } from "../types";

const drop = (f: Focus) => f?.env === "deneigement" && setFocus(null);

const Nothing = () => null;

export const deneigement: EnvModule = {
  id: "deneigement",
  // les trois zones couvrent la ville : vue large, inclinée
  camera: { center: [-72.585, 46.355], zoom: 11.6, pitch: 40, bearing: -15 },
  attribution: [ZONES_ATTRIBUTION],
  mount: () => {
    drop(territoireStore.getState().focus);
    return territoireStore.subscribe((s, prev) => void (s.focus !== prev.focus && drop(s.focus)));
  },
  Scene: Nothing,
  Panel: () => <EnvPanel env="deneigement" subtitle="Zones réelles · feux, ressources et neige simulés" />,
};
