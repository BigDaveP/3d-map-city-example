"use client";
/**
 * Navigation entre les démos. Le menu « Démos » est un <details> : il fonctionne sans JavaScript,
 * avec des liens ordinaires. Le dialogue « À propos » est un <dialog> natif (Échap pour fermer,
 * focus piégé par le navigateur) ; il demande JavaScript pour s'ouvrir.
 */
import Link from "next/link";
import { useRef } from "react";
import { ABOUT, DEMOS, type DemoId } from "./demos";
import "./demo-nav.css";

export { DEMOS } from "./demos";

export default function DemoNav({ current }: { current: DemoId }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const about = ABOUT[current];
  const title = DEMOS.find((d) => d.id === current)!.title;
  return (
    <nav className="demo-nav" aria-label="Démos">
      <details>
        <summary>Démos</summary>
        <ul>
          {DEMOS.map((d) => (
            <li key={d.id}>
              <Link href={d.href} aria-current={d.id === current ? "page" : undefined}>
                <strong>{d.title}</strong>
                <span>{d.sentence}</span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
      <button type="button" onClick={() => dlg.current?.showModal()}>
        À propos de cette démo
      </button>
      <dialog ref={dlg} aria-labelledby="about-title" onClick={(e) => e.target === dlg.current && dlg.current.close()}>
        <h2 id="about-title">À propos : {title}</h2>
        <h3>Ce qu&apos;on regarde</h3>
        <p>{about.looking}</p>
        <h3>Ce qui est simulé</h3>
        <p>{about.simulated}</p>
        <h3>Quoi essayer</h3>
        <ul>
          {about.tryIt.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <form method="dialog">
          <button autoFocus>Fermer</button>
        </form>
      </dialog>
    </nav>
  );
}
