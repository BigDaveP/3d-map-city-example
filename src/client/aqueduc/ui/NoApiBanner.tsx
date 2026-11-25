"use client";
/**
 * Bandeau du visiteur sans l'API HTML-in-Canvas (Chrome ou Edge ordinaire) : dit pourquoi la page est
 * en mode classique, propose la vidéo de la version HTML-in-Canvas (seulement si le fichier existe) et
 * indique comment activer l'option. Compact, au-dessus de la carte (jamais dessus) et refermable ; la
 * fermeture est retenue pour la session.
 */
import { useEffect, useRef, useState } from "react";
import { useAq } from "../useAq";

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
  const api = useAq((s) => s.api);
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
    if (api !== "absente" || dismissed !== false) return;
    let gone = false;
    fetch(VIDEO_URL, { method: "HEAD" })
      .then((r) => !gone && setHasVideo(r.status === 200))
      .catch(() => {});
    return () => void (gone = true);
  }, [api, dismissed]);

  useEffect(() => {
    if (!playing) return;
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (setPlaying(false), opener.current?.focus());
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [playing]);

  if (api !== "absente" || dismissed !== false) return null;
  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setDismissed(true);
  };
  return (
    <section className="aq-noapi" aria-label="Version classique" data-testid="noapi">
      <p className="aq-noapi-text">Votre navigateur n&apos;active pas HTML-in-Canvas : vous voyez la version classique.</p>
      <div className="aq-noapi-btns">
        {hasVideo && (
          <button ref={opener} type="button" className="aq-btn aq-pri" onClick={() => setPlaying(true)}>
            Voir la version HTML-in-Canvas en vidéo
          </button>
        )}
        <button type="button" className="aq-btn" aria-expanded={how} aria-controls="aq-noapi-how" onClick={() => setHow(!how)}>
          Comment l&apos;activer
        </button>
        <button type="button" className="aq-close aq-noapi-x" aria-label="Fermer le bandeau" onClick={dismiss}>
          ×
        </button>
      </div>
      {how && (
        <p id="aq-noapi-how" className="aq-noapi-how">
          Ouvrez <code>chrome://flags/#canvas-draw-element</code>, activez l&apos;option, puis relancez Chrome (ou utilisez un jeton d&apos;essai Origin Trial).
        </p>
      )}
      {playing && (
        <div className="aq-noapi-video" role="dialog" aria-modal="true" aria-label="Version HTML-in-Canvas en vidéo" onClick={(e) => e.target === e.currentTarget && setPlaying(false)}>
          <div className="aq-noapi-frame">
            <video src={VIDEO_URL} controls autoPlay muted playsInline />
            <button ref={closeBtn} type="button" className="aq-btn" onClick={() => (setPlaying(false), opener.current?.focus())}>
              Fermer la vidéo
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
