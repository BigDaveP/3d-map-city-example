"use client";
/**
 * Environnement Déneigement, version minimale (en attendant ses couches, sa scène et ses opérations) :
 * cadrage sur les trois zones de stationnement de nuit et panneau à son nom. Il remplit déjà
 * l'interface de module : rien à monter, donc rien à démonter.
 */
import { EnvPanel } from "../../shell/EnvPanel";
import type { EnvModule } from "../types";

const Nothing = () => null;

export const deneigement: EnvModule = {
  id: "deneigement",
  // les trois zones couvrent la ville : vue large, inclinée
  camera: { center: [-72.585, 46.355], zoom: 11.6, pitch: 40, bearing: -15 },
  attribution: ["Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0"],
  mount: () => () => {},
  Scene: Nothing,
  Panel: () => <EnvPanel env="deneigement" subtitle="Zones réelles · feux, ressources et neige simulés" />,
};
