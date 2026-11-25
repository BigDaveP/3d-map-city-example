"use client";
/**
 * Cadre commun du panneau d'un environnement (couches et opérations), en haut à gauche : nom et
 * mention de ce qui est réel ou simulé, opérations toujours visibles, corps repliable (replié par
 * défaut sur un écran étroit). Chaque module y met son contenu.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { ENVS, type EnvId } from "@/lib/territoire/envs";
import { EnvIcon } from "./EnvIcon";

interface Props {
  env: EnvId;
  /** ce qui est réel et ce qui est simulé, en une ligne */
  subtitle: string;
  /** opérations, visibles même panneau replié */
  operations?: ReactNode;
  /** rappel affiché dans l'en-tête quand le panneau est replié */
  collapsedHint?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function EnvPanel({ env, subtitle, operations, collapsedHint, className, children }: Props) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  useEffect(() => {
    if (window.matchMedia("(max-width: 720px)").matches) setOpen(false);
  }, []);
  const title = ENVS[env].title;
  return (
    <section className={`tr-envpanel aq-panel${className ? ` ${className}` : ""}`} aria-label={`${title} : couches et opérations`} data-env={env}>
      <header className="tr-envpanel-h">
        <span className="tr-envpanel-icon">
          <EnvIcon env={env} />
        </span>
        <span className="tr-envpanel-t">
          <h2>{title}</h2>
          <span className="tr-envpanel-sub">
            {subtitle}
            {!open && collapsedHint}
          </span>
        </span>
        {children && (
          <button type="button" className="tr-envpanel-toggle" aria-expanded={open} aria-controls={bodyId} aria-label={open ? "Replier le panneau" : "Déplier le panneau"} onClick={() => setOpen(!open)}>
            <span className="aq-caret" aria-hidden="true" />
          </button>
        )}
      </header>
      {operations && <div className="tr-envpanel-ops">{operations}</div>}
      {children && open && (
        <div id={bodyId} className="tr-envpanel-body">
          {children}
        </div>
      )}
    </section>
  );
}
