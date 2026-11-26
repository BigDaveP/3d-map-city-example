/**
 * Interface d'un environnement (spec 5.4) : la scène commune (`TerritoireScene`) garde la carte et
 * monte un module à la fois. Le module apporte son cadrage, ses couches et abonnements (`mount`,
 * qui rend une fonction de démontage complète), ses inscriptions dans la scène, son panneau et sa
 * fiche ; il peut aussi alimenter la frise commune et la recherche de la barre.
 */
import type { FC, ReactNode } from "react";
import type { Map as MlMap } from "maplibre-gl";
import type { Metrics } from "@/client/hic3d/metrics";
import type { EnvId } from "@/lib/territoire/envs";
import type { SearchHit } from "@/lib/territoire/search";

export interface SceneCtx {
  ml: typeof import("maplibre-gl");
  map: MlMap;
  metrics: Metrics;
}

export interface Camera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Ce que le module ajoute à la frise commune : légende (colonne de gauche) et tracé (graphique). */
export interface TimelineParts {
  caption: ReactNode;
  curve: ReactNode;
  /**
   * L'horloge est menée par le module (scénario guidé) : libellé affiché à la place de la date
   * (« Scénario · étape 2 sur 5 »), et « Maintenant » retiré ; null sinon.
   */
  driven: string | null;
}

export interface TimelineTrack {
  /**
   * Rendu des parties du module pour la journée [day, dayEnd) (23 h, 24 h ou 25 h) à l'heure
   * simulée `now` ; `children` les place dans la frise (un seul rendu, une seule requête de courbe).
   */
  Track: FC<{ day: number; dayEnd: number; now: number; children(parts: TimelineParts): ReactNode }>;
  /** curseur déplacé à t : le module peut l'interpréter (scénario : étape visée) ; sinon `seek` */
  seek?(t: number): void;
}

export interface EnvModule {
  id: EnvId;
  camera: Camera;
  /** affiché dans le contrôle d'attribution de MapLibre tant que le module est actif */
  attribution: string[];
  /** sources, couches, abonnements ; renvoie le démontage complet */
  mount(ctx: SceneCtx): () => void;
  /** inscriptions dans la scène (HicHost en mode HTML-in-Canvas, DOM en mode classique) */
  Scene: FC<{ ctx: SceneCtx }>;
  /** couches et opérations (et le récit pendant un scénario guidé) */
  Panel: FC<{ ctx: SceneCtx }>;
  /** fiche, à la sélection */
  Inspector?: FC<{ ctx: SceneCtx }>;
  timeline?: TimelineTrack;
  /** résultats de recherche qui demandent les données chargées du module (conduites, capteurs…) */
  search?(q: string): SearchHit[];
}
