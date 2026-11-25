import type { Viewport } from "next";
import SceneShell from "./SceneShell";

/**
 * Mise en page des vues 3D (`/carte/[env]`). Elle ne se rend pas de nouveau quand on passe d'un
 * environnement à l'autre (navigation côté client entre routes sœurs) : la scène qu'elle porte, et
 * avec elle la carte MapLibre et son contexte WebGL, survit au changement. La page de chaque
 * environnement (`children`) est le résumé rendu par le serveur, lisible sans JavaScript, que la
 * scène recouvre une fois montée.
 */
export default function CarteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="aq-page">
      {children}
      <SceneShell />
    </div>
  );
}

/** Barre claire du navigateur, comme celle de l'application. */
export const viewport: Viewport = { themeColor: "#ffffff" };
