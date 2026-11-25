import Link from "next/link";
import { AqueducSection } from "./Aqueduc";
import "./bench.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Banc de mesures · Réseau d'eau, classique vs HTML-in-Canvas" };

export default function BenchPage() {
  return (
    <main className="bench viz-root">
      <p className="sim-banner" role="note">⚠️ Données simulées — mesures prises sur la machine décrite ci-dessous.</p>
      <nav className="bench-nav" aria-label="Navigation">
        <Link href="/">← Vue d&apos;ensemble</Link>
        <Link href="/carte/aqueduc">Aqueduc en 3D</Link>
        <Link href="/a-propos">À propos</Link>
      </nav>
      <h1>Banc de mesures</h1>
      <p className="lead">
        Le banc rejoue l&apos;environnement <Link href="/carte/aqueduc">Aqueduc</Link> de la démo dans Chromium, piloté par Playwright, une fois en mode classique (étiquettes en marqueurs
        DOM) et une fois en HTML-in-Canvas (étiquettes dessinées dans la scène 3D), puis compare images par seconde, temps JS, captures et latence. Pour le
        relancer : <code>npm run bench:aqueduc</code> contre <code>next start</code> (voir le README).
      </p>
      <AqueducSection />
    </main>
  );
}
