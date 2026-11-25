"use client";
/**
 * Bandeau du visiteur sans l'API HTML-in-Canvas (Chrome ou Edge ordinaire) : dit pourquoi la page est
 * en mode classique, propose la vidéo de la version HTML-in-Canvas (seulement si le fichier existe) et
 * indique comment activer l'option. Compact, au-dessus de la carte (jamais dessus) et refermable ; la
 * fermeture est retenue pour la session.
 */
import { useEffect, useRef, useState } from "react";
import { CITY, SIM_CREDIT } from "@/lib/aqueduc/city";
import { useTerritoire } from "../useTerritoire";

export const VIDEO_URL = "/aqueduc/scenario-hic.webm";
const DISMISS_KEY = "aq-noapi-dismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function NoApiBanner() {
  const api = useTerritoire((s) => s.api);
  const fallback = useTerritoire((s) => s.fallback);
  const mode = useTerritoire((s) => s.mode);
  // API présente mais désactivée pendant l'affichage (vérification, GPU) : même bandeau, autre texte
  const lost = api !== "absente" && fallback !== "" && mode === "classic";
  const show = api === "absente" || lost;
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [how, setHow] = useState(false);
  const [playing, setPlaying] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  // lu après le montage : le rendu serveur et l'hydratation ne le voient pas
  useEffect(() => setDismissed(readDismissed()), []);

  // la vidéo n'est proposée que si le fichier répond 200
  useEffect(() => {
    if (!show || dismissed !== false) return;
    let gone = false;
    fetch(VIDEO_URL, { method: "HEAD" })
      .then((r) => !gone && setHasVideo(r.status === 200))
      .catch(() => {});
    return () => void (gone = true);
  }, [show, dismissed]);

  // <dialog> natif ouvert en modal : focus piégé et Échap gérés par le navigateur (comme « À propos »)
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!playing || !d) return;
    if (!d.open) d.showModal();
    closeBtn.current?.focus();
  }, [playing]);
  // fermé (bouton, Échap, clic hors de la vidéo) : démonté, et le focus revient au bouton d'ouverture
  const onClose = () => {
    setPlaying(false);
    opener.current?.focus();
  };

  if (!show || dismissed !== false) return null;
  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setDismissed(true);
  };
  return (
    <section
      className="aq-noapi"
      aria-label="Version classique"
      data-testid="noapi"
    >
      <p
        className="aq-noapi-text"
        data-testid={lost ? "noapi-lost" : undefined}
      >
        {lost ? (
          <>
            HTML-in-Canvas s&apos;est désactivé pendant l&apos;affichage : vous
            voyez la version classique.{" "}
            <span className="aq-noapi-why">{fallback}</span>
          </>
        ) : (
          "Votre navigateur n'active pas HTML-in-Canvas : vous voyez la version classique."
        )}
      </p>
      <div className="aq-noapi-btns">
        {hasVideo && (
          <button
            ref={opener}
            type="button"
            className="aq-btn aq-pri"
            onClick={() => setPlaying(true)}
          >
            Voir la version HTML-in-Canvas en vidéo
          </button>
        )}
        {!lost && (
          <button
            type="button"
            className="aq-btn"
            aria-expanded={how}
            aria-controls="aq-noapi-how"
            onClick={() => setHow(!how)}
          >
            Comment l&apos;activer
          </button>
        )}
        <button
          type="button"
          className="aq-close aq-noapi-x"
          aria-label="Fermer le bandeau"
          onClick={dismiss}
        >
          ×
        </button>
      </div>
      {how && !lost && (
        <p id="aq-noapi-how" className="aq-noapi-how">
          Ouvrez <code>chrome://flags/#canvas-draw-element</code>, activez
          l&apos;option, puis relancez Chrome (ou utilisez un jeton d&apos;essai
          Origin Trial).
        </p>
      )}
      {playing && (
        <dialog
          ref={dlg}
          className="aq-noapi-video"
          aria-label="Version HTML-in-Canvas en vidéo"
          onClose={onClose}
          onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        >
          <div className="aq-noapi-frame">
            <video src={VIDEO_URL} controls autoPlay muted playsInline aria-describedby="aq-noapi-credits" />
            <p id="aq-noapi-credits" className="aq-noapi-credits">
              {CITY.attribution}. {SIM_CREDIT}.
            </p>
            <button
              ref={closeBtn}
              type="button"
              className="aq-btn"
              onClick={() => dlg.current?.close()}
            >
              Fermer la vidéo
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
