"use client";
/** Scène montée après l'hydratation (ssr: false) : MapLibre et WebGL n'existent pas côté serveur. */
import dynamic from "next/dynamic";

// pas d'écran de chargement : le résumé rendu par le serveur reste visible jusqu'au montage
const TerritoireScene = dynamic(() => import("@/client/territoire/scene/TerritoireScene"), { ssr: false });

export default function SceneShell() {
  return <TerritoireScene />;
}
