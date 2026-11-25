"use client";
/**
 * Carte d'un environnement sur l'accueil : mini-carte, nom, état en une ligne (simulé ou réel), et
 * ce qui est réel ou simulé. Toute la carte mène à la vue 3D (lien étiré sur le titre) ; celles du
 * lot 2 sont « À venir » et sans lien.
 *
 * La mini-carte est un dessin (fleuve, rues, motif de l'environnement) en attendant les captures de
 * `public/territoire/mini-*.png` (tâche 9).
 */
import Link from "next/link";
import type { EnvId } from "@/lib/territoire/envs";
import type { HomeEnv } from "@/lib/territoire/home";
import { EnvIcon } from "../shell/EnvIcon";
import { setFocus } from "../store";

/** Motif propre à chaque environnement, posé sur le fond commun (rues, fleuve). */
function Motif({ env }: { env: EnvId }) {
  switch (env) {
    case "aqueduc":
      return (
        <g className="m-line">
          <path d="M18 92 70 70l38 6 44-30 34 8 40-26" />
          <path d="M70 70 62 30M108 76l10 30M152 46l-6-30M186 54l16 34" />
          <path className="m-thin" d="M62 30l36-8M118 106l40-4M146 16l40 4M202 88l20-10" />
          {[[70, 70], [108, 76], [152, 46], [186, 54]].map(([x, y]) => (
            <circle key={`${x}`} className="m-node" cx={x} cy={y} r="3.2" />
          ))}
        </g>
      );
    case "deneigement":
      return (
        <g>
          <path className="m-zone" d="M20 24h62l10 38-30 26H20Z" />
          <path className="m-zone" d="M96 18h58l-4 48-44 10-14-20Z" />
          <path className="m-zone" d="M160 30h60v58h-74l6-22Z" />
          {[[34, 40], [58, 52], [44, 72], [112, 32], [132, 50], [178, 46], [200, 70], [168, 78]].map(([x, y]) => (
            <circle key={`${x}-${y}`} className="m-dot" cx={x} cy={y} r="2.6" />
          ))}
        </g>
      );
    case "collecte":
      return (
        <g>
          <path className="m-zone" d="M16 20h70v44H16Z" />
          <path className="m-zone m-b" d="M90 20h64v44H90Z" />
          <path className="m-zone m-c" d="M158 20h66v44h-66Z" />
          <path className="m-route" d="M24 80h70l12-22h60l14 22h40" />
        </g>
      );
    case "zonage":
      return (
        <g className="m-patch">
          {[
            [16, 16, 44, 30, 0.55], [64, 16, 52, 30, 0.3], [120, 16, 38, 30, 0.8], [162, 16, 62, 30, 0.42],
            [16, 50, 30, 40, 0.35], [50, 50, 60, 40, 0.7], [114, 50, 50, 40, 0.25], [168, 50, 56, 40, 0.6],
          ].map(([x, y, w, h, o]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="2" style={{ opacity: o }} />
          ))}
        </g>
      );
    case "evaluation":
      return (
        <g className="m-patch">
          {Array.from({ length: 40 }, (_, i) => {
            const x = 18 + (i % 10) * 21;
            const y = 18 + Math.floor(i / 10) * 20;
            return <rect key={i} x={x} y={y} width="16" height="15" rx="2" style={{ opacity: 0.18 + (((i * 37) % 11) / 11) * 0.7 }} />;
          })}
        </g>
      );
  }
}

function MiniMap({ env }: { env: EnvId }) {
  return (
    <svg className="tr-mini" data-env={env} viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect className="m-land" width="240" height="110" />
      <path className="m-street" d="M0 38h240M0 76h240M48 0v110M104 0v110M160 0v110M212 0v110M0 8l240 60" />
      <path className="m-river" d="M0 104c50-6 90-2 130-10s80-20 110-22v38H0Z" />
      <Motif env={env} />
    </svg>
  );
}

export function EnvCard({ env }: { env: HomeEnv }) {
  const soon = env.href === null;
  return (
    <li className="tr-envcard" data-env={env.id} data-soon={soon || undefined}>
      <MiniMap env={env.id} />
      <div className="tr-envcard-b">
        <h3 className="tr-envcard-t">
          <span className="tr-envcard-i">
            <EnvIcon env={env.id} size={16} />
          </span>
          {env.href ? (
            // une carte ouverte depuis l'accueil n'a rien à mettre en avant : pas de focus resté d'avant
            <Link href={env.href} className="tr-envcard-link" onNavigate={() => setFocus(null)}>
              {env.title}
            </Link>
          ) : (
            env.title
          )}
          {soon && <span className="tr-soon">À venir</span>}
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
      {!soon && (
        <span className="tr-envcard-go" aria-hidden="true">
          Ouvrir →
        </span>
      )}
    </li>
  );
}
