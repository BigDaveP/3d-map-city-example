"use client";
/**
 * Hydratation : le mur n'est jamais rendu côté serveur (ssr: false). Il est monté après
 * l'hydratation de la page ; les cartes destinées au canvas sont ensuite insérées dans le
 * <canvas> par un portail React (voir CanvasWall). Aucun nœud du canvas ne passe donc par
 * l'hydratation, ce qui évite tout décalage serveur/client.
 */
import dynamic from "next/dynamic";
import { useCallback } from "react";
import type { Mode } from "@/client/ui";

const WallApp = dynamic(() => import("@/client/wall/WallApp"), {
  ssr: false,
  loading: () => <p className="noscript">Chargement du mur…</p>,
});

export default function WallShell({ n, mode }: { n: number; mode?: Mode }) {
  const onAside = useCallback((open: boolean) => {
    document.querySelector(".app")?.classList.toggle("no-aside", !open);
  }, []);
  return <WallApp n={n} initialMode={mode} onAside={onAside} />;
}
