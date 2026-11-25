import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ENVS, isEnvId, LOT1_ENVS, type EnvId } from "@/lib/territoire/envs";
import { BrandMark } from "@/client/territoire/shell/EnvIcon";
import { AqueducSummary } from "./AqueducSummary";

/** Les environnements du lot 1 sont générés à la construction ; les autres répondent à la demande. */
export function generateStaticParams() {
  return LOT1_ENVS.map((env) => ({ env }));
}

type Params = Promise<{ env: string }>;

/** Environnement de l'URL : 404 s'il n'existe pas, retour à l'accueil s'il est « À venir » (lot 2). */
async function envOf(params: Params): Promise<EnvId> {
  const { env } = await params;
  if (!isEnvId(env)) notFound();
  if (ENVS[env].lot !== 1) redirect("/");
  return env;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { env } = await params;
  if (!isEnvId(env)) return {};
  return { title: `${ENVS[env].title} · Territoire · Trois-Rivières`, description: ENVS[env].blurb };
}

/** Barre du rendu serveur : le nom de l'outil, les environnements et « À propos », en liens ordinaires. */
function SsrBar({ env }: { env: EnvId }) {
  return (
    <header className="aq-bar aq-ssr-bar">
      <span className="tr-brand">
        <BrandMark />
        <span className="tr-brand-name">Territoire · Trois-Rivières</span>
        <span className="tr-badge">Démo</span>
      </span>
      <nav className="tr-ssr-nav" aria-label="Environnements">
        {LOT1_ENVS.map((id) => (
          <Link key={id} href={`/carte/${id}`} aria-current={id === env ? "page" : undefined}>
            {ENVS[id].title}
          </Link>
        ))}
        <Link href="/a-propos" prefetch={false}>
          À propos
        </Link>
      </nav>
      <span className="aq-sim">Simulation</span>
    </header>
  );
}

/** Résumé d'un environnement sans résumé propre (encore) : ce qu'il montre, ce qui est simulé. */
function EnvSummary({ env }: { env: EnvId }) {
  return (
    <main className="aq-ssr" aria-labelledby="tr-title">
      <h1 id="tr-title">{ENVS[env].title} · Trois-Rivières</h1>
      <p className="aq-lede">{ENVS[env].blurb}</p>
      {env === "deneigement" && (
        <p className="aq-attrib">
          Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0. Feux d&apos;interdiction, ressources et
          avancement : simulation.
        </p>
      )}
      <noscript>
        <p className="aq-note">La carte 3D interactive demande JavaScript et WebGL2. Ce résumé reste consultable sans eux.</p>
      </noscript>
    </main>
  );
}

/** Vue 3D d'un environnement : le résumé rendu par le serveur ; la scène vient de la mise en page. */
export default async function EnvPage({ params }: { params: Params }) {
  const env = await envOf(params);
  return (
    <>
      <SsrBar env={env} />
      {env === "aqueduc" ? <AqueducSummary /> : <EnvSummary env={env} />}
    </>
  );
}
