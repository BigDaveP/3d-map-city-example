import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mur de supervision — HTML-in-Canvas",
  description: "Démo d'apprentissage : 1 000 cartes HTML, mode DOM virtualisé vs HTML-in-Canvas (WebGL2). Données simulées.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d1117" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
