"use client";
/**
 * Carte d'un environnement sur l'accueil : capture réelle de sa vue 3D (public/territoire, produite
 * par scripts/territoire-thumbs.ts) avec une légende d'un chiffre, nom, état en une ligne (simulé ou
 * réel) et ce qui est réel ou simulé. Toute la carte mène à la vue 3D (lien étiré sur le titre) ;
 * celles du lot 2 sont plus petites, « À venir » et sans lien. Lisible sans JavaScript (image et lien
 * ordinaires).
 */
import Link from "next/link";
import type { HomeEnv } from "@/lib/territoire/home";
import { THUMBS } from "@/lib/territoire/thumbs";
import { EnvIcon, UiIcon } from "../shell/EnvIcon";
import { setFocus } from "../store";

export function EnvCard({ env, eager = false }: { env: HomeEnv; eager?: boolean }) {
  const soon = env.href === null;
  const thumb = THUMBS[env.id];
  return (
    <li className="tr-envcard" data-env={env.id} data-soon={soon || undefined}>
      <figure className="tr-envcard-fig">
        <img src={thumb.src} alt={thumb.alt} width={thumb.width} height={thumb.height} loading={eager ? "eager" : "lazy"} decoding="async" />
        {thumb.caption && <figcaption className="tr-envcard-cap">{thumb.caption}</figcaption>}
      </figure>
      <div className="tr-envcard-b">
        <h3 className="tr-envcard-t">
          <EnvIcon env={env.id} />
          {env.href ? (
            // une carte ouverte depuis l'accueil n'a rien à mettre en avant : pas de focus resté d'avant
            <Link href={env.href} className="tr-envcard-link" onNavigate={() => setFocus(null)}>
              {env.title}
            </Link>
          ) : (
            env.title
          )}
          {soon ? <span className="tr-soon">À venir</span> : <UiIcon name="chevron-right" />}
        </h3>
        {soon ? (
          <p className="tr-envcard-d">{env.blurb}</p>
        ) : (
          <p className="tr-status" data-tone={env.status.tone}>
            <span className="tr-dot" aria-hidden="true" />
            {env.status.text}
          </p>
        )}
        <p className="tr-envcard-r">{env.reality}</p>
      </div>
    </li>
  );
}
