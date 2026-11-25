import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import "@/client/territoire/theme.css";
import "@/client/territoire/shell/shell.css";
import "@/client/aqueduc/aqueduc.css";
import { originTrialMeta } from "@/lib/origin-trial";

export const metadata: Metadata = {
  title: "Territoire · Trois-Rivières (démo HTML-in-Canvas)",
  description:
    "Démo non officielle de gestion du territoire en 3D avec HTML-in-Canvas : réseau d'eau potable et déneigement de Trois-Rivières, données ouvertes et simulation.",
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
