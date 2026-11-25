"use client";
/** Application montée après l'hydratation (ssr: false) : MapLibre et WebGL n'existent pas côté serveur. */
import dynamic from "next/dynamic";
import type { Mode } from "@/client/territoire/store";

// pas d'écran de chargement : le résumé rendu par le serveur reste visible jusqu'au montage
const AqueducApp = dynamic(() => import("@/client/aqueduc/AqueducApp"), { ssr: false });

export default function AqueducShell({ mode }: { mode?: Mode }) {
  return <AqueducApp initialMode={mode} />;
}
