import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import "@/client/aqueduc/aqueduc.css";
import { originTrialMeta } from "@/lib/origin-trial";

export const metadata: Metadata = {
  title: "Démos HTML-in-Canvas",
  description: "Démos d'apprentissage HTML-in-Canvas : réseau d'eau 3D, mur de supervision et banc de mesures. Données simulées.",
};

/** Le jeton Origin Trial est lu à la requête (variable d'environnement d'exécution). */
export const dynamic = "force-dynamic";

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d1117" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const ot = originTrialMeta(process.env);
  return (
    <html lang="fr">
      {ot && (
        <head>
          <meta httpEquiv={ot.httpEquiv} content={ot.content} />
        </head>
      )}
      <body>{children}</body>
    </html>
  );
}
