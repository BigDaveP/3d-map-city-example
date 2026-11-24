import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./carte/carte.css";
import { originTrialMeta } from "@/lib/origin-trial";

export const metadata: Metadata = {
  title: "Mur de supervision — HTML-in-Canvas",
  description: "Démo d'apprentissage : 1 000 cartes HTML, mode DOM virtualisé vs HTML-in-Canvas (WebGL2). Données simulées.",
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
