"use client";
/**
 * Navigation de la barre : un lien ordinaire vers l'autre page (la démo ou son banc de mesures),
 * utilisable sans JavaScript, et le dialogue « À propos », un <dialog> natif (Échap pour fermer,
 * focus piégé par le navigateur) qui demande JavaScript pour s'ouvrir.
 */
import Link from "next/link";
import { useRef } from "react";
import { ABOUT, otherPage, PAGES, type PageId } from "./demos";
import "./demo-nav.css";

export default function DemoNav({ current }: { current: PageId }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const about = ABOUT[current];
  const other = PAGES[otherPage(current)];
  return (
    <nav className="demo-nav" aria-label="Navigation">
      <Link href={other.href} className="demo-nav-link">
        {other.title}
      </Link>
      <button type="button" onClick={() => dlg.current?.showModal()}>
        À propos
      </button>
      <dialog ref={dlg} aria-labelledby="about-title" onClick={(e) => e.target === dlg.current && dlg.current.close()}>
        <h2 id="about-title">À propos : {PAGES[current].title}</h2>
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
