"use client";
/**
 * Sélecteur d'environnement à vignettes (références komoot et Apple Plans) : un bouton-vignette en
 * bas à gauche de la carte ouvre une fenêtre avec les cinq environnements. Ceux du lot 2 sont
 * marqués « À venir » et inactifs. Navigation côté client (`router.push`, sans rechargement : la
 * carte reste). Clavier : flèches entre les vignettes, Début / Fin, Échap pour refermer.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ENVS, type EnvId } from "@/lib/territoire/envs";
import { EnvIcon } from "./EnvIcon";

const IDS = Object.keys(ENVS) as EnvId[];

/** Vignette (image de la vue de l'environnement à venir ; en attendant, un aplat dessiné en CSS). */
function Thumb({ env }: { env: EnvId }) {
  return (
    <span className="tr-thumb" data-env={env} aria-hidden="true">
      <EnvIcon env={env} size={20} />
    </span>
  );
}

export function EnvSwitcher({ current }: { current: EnvId | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const popId = useId();

  // ouverture : le focus va à l'environnement courant ; fermeture : Échap ou clic à l'extérieur
  useEffect(() => {
    if (!open) return;
    items.current[Math.max(0, IDS.indexOf(current ?? "aqueduc"))]?.focus();
    const out = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, [open, current]);

  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const choose = (id: EnvId) => {
    if (ENVS[id].lot !== 1) return;
    setOpen(false);
    if (id !== current) router.push(`/carte/${id}${location.search}`, { scroll: false });
    opener.current?.focus();
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return close();
    }
    const i = items.current.findIndex((b) => b === document.activeElement);
    const n = IDS.length;
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    items.current[(next + n) % n]?.focus();
  };

  const cur = current ? ENVS[current] : null;
  return (
    <div className="tr-switcher" ref={box}>
      <button
        ref={opener}
        type="button"
        className="tr-switcher-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen(!open)}
      >
        {current && <Thumb env={current} />}
        <span className="tr-switcher-l">
          <span className="tr-switcher-k">Environnement</span>
          <b>{cur?.title ?? "Choisir"}</b>
        </span>
        <span className="tr-switcher-swap" aria-hidden="true" />
      </button>
      {open && (
        <div id={popId} className="tr-switcher-pop" role="dialog" aria-label="Changer d'environnement" onKeyDown={key}>
          <p className="tr-switcher-h">Environnements</p>
          <ul>
            {IDS.map((id, i) => {
              const e = ENVS[id];
              const soon = e.lot !== 1;
              return (
                <li key={id}>
                  <button
                    ref={(el) => void (items.current[i] = el)}
                    type="button"
                    className="tr-env"
                    aria-current={id === current ? "page" : undefined}
                    aria-disabled={soon || undefined}
                    aria-describedby={`${popId}-${id}`}
                    onClick={() => choose(id)}
                  >
                    <Thumb env={id} />
                    <span className="tr-env-t">
                      <b>{e.title}</b>
                      {soon && <span className="tr-soon">À venir</span>}
                    </span>
                    <span id={`${popId}-${id}`} className="tr-env-d">
                      {e.blurb}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
