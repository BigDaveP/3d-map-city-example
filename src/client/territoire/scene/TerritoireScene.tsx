"use client";
/**
 * Scène persistante de `/carte/[env]` : une seule carte MapLibre (un seul canvas, un seul contexte
 * WebGL) pour toute la vie de la mise en page, et l'interface commune autour (barre, sélecteur,
 * frise, bandeau sans l'API). L'environnement vient de l'URL (`useSelectedLayoutSegment`) ; à chaque
 * changement, le module quitté est démonté (couches, sources, abonnements, surfaces), la caméra vole
 * vers le cadrage du suivant (1,2 s), puis celui-ci est monté.
 *
 * Pilotage : `window.__territoire = { map, env, store }` ; le module de l'aqueduc garde
 * `window.__aqueduc` (banc, vérifications de bout en bout).
 */
import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AttributionControl, Map as MlMap } from "maplibre-gl";
import { isEnvId, type EnvId } from "@/lib/territoire/envs";
import { detectApi } from "../../hic3d/detect";
import { Metrics } from "../../hic3d/metrics";
import { loadModule, MODULES } from "../modules";
import type { EnvModule, SceneCtx } from "../modules/types";
import { AppBar } from "../shell/AppBar";
import { EnvSwitcher } from "../shell/EnvSwitcher";
import { NoApiBanner } from "../shell/NoApiBanner";
import { Timeline } from "../shell/Timeline";
import { setFocus, territoireStore, type Mode } from "../store";
import { useTerritoire } from "../useTerritoire";
import { restyleBasemap, STYLE_URL, WORKER_URL } from "./basemap";

/** Durée du vol entre deux environnements. */
export const FLY_MS = 1200;

/**
 * Appelle `fn` une fois la caméra arrêtée (fin du vol, ou geste du visiteur qui l'interrompt) ; au
 * plus tard un peu après la durée prévue (vol remplacé par un saut, mouvement réduit). Renvoie
 * l'annulation.
 */
function afterMove(map: MlMap, ms: number, fn: () => void): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    cancel();
    fn();
  };
  const timer = setTimeout(run, ms + 400);
  const cancel = () => {
    clearTimeout(timer);
    map.off("moveend", run);
  };
  map.on("moveend", run);
  return () => {
    done = true;
    cancel();
  };
}

let serial = 0;

export default function TerritoireScene() {
  const segment = useSelectedLayoutSegment();
  const env: EnvId | null = isEnvId(segment) && MODULES[segment] ? segment : null;
  const container = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<SceneCtx | null>(null);
  const [active, setActive] = useState<EnvModule | null>(null);
  const [error, setError] = useState("");
  const [envError, setEnvError] = useState("");
  // module en cours de chargement (pas pendant le vol : la carte bouge déjà)
  const [pending, setPending] = useState(false);
  const mode = useTerritoire((s) => s.mode);
  // environnement d'arrivée : cadrage de départ de la carte, monté sans vol
  const startEnv = useRef(env);
  const flown = useRef(false);
  const attrib = useRef<AttributionControl | null>(null);

  // la vue rendue par le serveur (résumé lisible sans JavaScript) laisse la place à la scène, sauf
  // si la carte ne peut pas démarrer (MapLibre, WebGL2, réseau) : le résumé reste alors lisible
  useEffect(() => {
    if (error) return;
    document.documentElement.dataset.aq = "app";
    return () => void delete document.documentElement.dataset.aq;
  }, [error]);

  // --- mesure des images (toute la vie de la carte)
  useEffect(() => {
    if (!ctx) return;
    let raf = 0;
    const tick = (now: number) => {
      ctx.metrics.frameEnd(ctx.metrics.pendingWork());
      ctx.metrics.frameStart(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ctx]);

  // --- environnement : démonte le précédent, vole vers le suivant, puis le monte
  useEffect(() => {
    if (!ctx || !env) return;
    const { ml, map } = ctx;
    let cancelled = false;
    let unmount: (() => void) | null = null;
    let wait = () => {};
    // attribution des données de l'environnement, à côté de celle du fond de carte
    const attribution = (custom: string[]) => {
      if (attrib.current) map.removeControl(attrib.current);
      attrib.current = new ml.AttributionControl({ compact: window.matchMedia("(max-width: 720px)").matches, customAttribution: custom });
      map.addControl(attrib.current);
    };
    territoireStore.setState({ env });
    setEnvError("");
    setPending(true);
    loadModule(env)!.then(
      (mod) => {
        if (cancelled) return;
        setPending(false);
        const mount = () => {
          if (cancelled) return;
          unmount = mod.mount(ctx);
          // le module a lu le focus qui le visait ; un focus visant un autre environnement (recherche
          // ou alerte suivie d'un autre choix) ne sera plus lu par personne : on l'efface
          const f = territoireStore.getState().focus;
          if (f && f.env !== mod.id) setFocus(null);
          attribution(mod.attribution);
          setActive(mod);
        };
        if (!flown.current && env === startEnv.current) {
          // arrivée : la carte est déjà au cadrage du module
          flown.current = true;
          return mount();
        }
        flown.current = true;
        map.flyTo({ ...mod.camera, duration: FLY_MS });
        wait = afterMove(map, FLY_MS, mount);
      },
      (e: Error) => {
        if (cancelled) return;
        setPending(false);
        setEnvError(e.message);
      },
    );
    return () => {
      cancelled = true;
      wait();
      setActive(null);
      unmount?.();
      if (attrib.current) attribution([]);
    };
  }, [ctx, env]);

  // --- détection de l'API, puis la carte, une fois, au cadrage de l'environnement d'arrivée.
  // Déclaré en dernier : au démontage de la mise en page, le module est démonté (effet ci-dessus)
  // avant que la carte ne soit retirée.
  useEffect(() => {
    const first = startEnv.current;
    if (!first) return;
    let disposed = false;
    let map: MlMap | undefined;
    const api = detectApi();
    // sans ?mode : HTML-in-Canvas si l'API est là ; la vérification des pixels (HicHost) rebascule
    // en classique si elle ne transmet rien
    const q = new URLSearchParams(location.search).get("mode");
    const wanted: Mode = q === "classic" || q === "hic" ? q : api.present ? "hic" : "classic";
    territoireStore.setState({
      api: api.present ? "détectée" : "absente",
      mode: api.present ? wanted : "classic",
      fallback: wanted === "hic" && !api.present ? `Mode classique : API HTML-in-Canvas absente (${api.detail}).` : "",
    });
    const w = window as unknown as Record<string, unknown>;
    Promise.all([import("maplibre-gl"), loadModule(first)!])
      .then(([ml, mod]) => {
        if (disposed || !container.current) return;
        ml.setWorkerUrl(WORKER_URL);
        const metrics = new Metrics();
        const m = new ml.Map({
          container: container.current,
          style: STYLE_URL,
          ...mod.camera,
          maxPitch: 75,
          canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false },
          attributionControl: false,
        });
        // repère d'identité : la même carte d'un environnement à l'autre (vérifications)
        (m as unknown as { __id: number }).__id = ++serial;
        map = m;
        w.__territoire = {
          map: m,
          store: territoireStore,
          get env() {
            return territoireStore.getState().env;
          },
        };
        m.on("load", () => {
          if (disposed) return;
          restyleBasemap(m);
          setCtx({ ml, map: m, metrics });
        });
      })
      .catch((e) => !disposed && setError((e as Error).message || "La carte n'a pas pu démarrer."));
    return () => {
      disposed = true;
      map?.remove();
      attrib.current = null;
      setCtx(null);
      delete w.__territoire;
      territoireStore.setState({ env: null });
    };
  }, []);

  // échec du démarrage : une alerte qui ne recouvre pas le résumé rendu par le serveur
  if (error)
    return (
      <p className="aq-fatal" role="alert">
        {error} Le résumé ci-dessous reste consultable ; la carte 3D demande WebGL2.
      </p>
    );

  // le module démonté disparaît dans le même rendu que le changement d'URL
  const shown = active && active.id === env ? active : null;
  return (
    <div className="aq-app tr-app" data-mode={mode} data-env={env ?? undefined}>
      <AppBar map={ctx?.map ?? null} env={env} />
      <NoApiBanner />
      <main className="aq-stage">
        <div className="aq-map" ref={container} role="region" aria-label="Carte 3D de Trois-Rivières" />
        {(!ctx || pending) && !envError && (
          <p className="aq-loading" role="status">
            {ctx ? "Chargement de l'environnement…" : "Chargement de la carte…"}
          </p>
        )}
        {envError && (
          <p className="aq-loading tr-env-error" role="alert">
            {envError} Choisissez un autre environnement ou rechargez la page.
          </p>
        )}
        {ctx && shown && <shown.Scene ctx={ctx} />}
        {ctx && shown && <shown.Panel ctx={ctx} />}
        {ctx && shown?.Inspector && <shown.Inspector ctx={ctx} />}
        <EnvSwitcher current={env} />
        <Timeline track={shown?.timeline ?? null} />
      </main>
    </div>
  );
}
