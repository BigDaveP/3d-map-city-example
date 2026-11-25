"use client";
/**
 * Accueil (spec 5.3) : vue d'ensemble de la ville à l'heure simulée, alertes résumées par gravité,
 * événements à venir, météo réelle, une carte par environnement et l'avertissement « non officiel ».
 *
 * Îlot client : le serveur l'a rendu à son « maintenant », sans action de visiteur (`snapshot`),
 * lisible sans JavaScript. Une fois hydraté, il recalcule le même instantané avec l'horloge commune
 * et les décisions du visiteur (`territoireStore`), chaque seconde. Pendant l'hydratation, il rend
 * exactement l'instantané du serveur (`useHydrated`) : aucun écart, aucun `suppressHydrationWarning`.
 * La météo (`weather`) est rendue par le serveur et passée telle quelle.
 */
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { THUMBS_CREDIT } from "@/lib/territoire/about";
import { ENVS } from "@/lib/territoire/envs";
import { homeSnapshot, type HomeSnapshot, type Mode } from "@/lib/territoire/home";
import type { Forecast } from "@/lib/territoire/meteo";
import { AlertBell } from "../shell/AlertBell";
import { BrandMark, UiIcon } from "../shell/EnvIcon";
import { offerForecast, territoireStore } from "../store";
import { useForecastRefresh, useHydrated, useSimNow, useTerritoire } from "../useTerritoire";
import { AlertsPanel } from "./AlertsPanel";
import { EnvCard } from "./EnvCard";

function NextEvents({ next }: { next: HomeSnapshot["next"] }) {
  return (
    <section className="tr-card tr-next" aria-labelledby="tr-next-h">
      <div className="tr-card-h">
        <h2 id="tr-next-h">À venir</h2>
        <span className="tr-sim">Journée scénarisée</span>
      </div>
      <ol className="tr-next-list">
        {next.map((e) => (
          <li key={e.at} data-env={e.env}>
            <span className="tr-diamond" data-env={e.env} data-future aria-hidden="true" />
            <span className="tr-next-time">
              {e.time}
              {e.tomorrow && <small>demain</small>}
            </span>
            <span className="tr-next-l">
              {e.label}
              <small>{ENVS[e.env].title}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Home({ snapshot, forecast, mode, weather }: { snapshot: HomeSnapshot; forecast: Forecast | null; mode: Mode | null; weather: ReactNode }) {
  const hydrated = useHydrated();
  const t = useSimNow();
  const actions = useTerritoire((s) => s.actions);
  const stored = useTerritoire((s) => s.forecast);
  const speed = useTerritoire((s) => s.clock.speed);

  // la prévision lue par le serveur sert aussi aux vues 3D (pas de second appel) ; plus récente que
  // celle du store (visite précédente), elle la remplace. Déclaré avant le rafraîchissement : il voit
  // donc la prévision du serveur et ne redemande rien avant 10 minutes.
  useEffect(() => offerForecast(forecast), [forecast]);
  useForecastRefresh();

  // pilotage des vérifications : l'horloge commune est réglable dès l'accueil (pas de carte ici)
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const api = {
      map: null,
      store: territoireStore,
      get env() {
        return territoireStore.getState().env;
      },
    };
    w.__territoire = api;
    return () => {
      if (w.__territoire === api) delete w.__territoire;
    };
  }, []);

  // avant l'effet ci-dessus (premier rendu après une navigation), le store peut encore se charger
  const snap = hydrated ? homeSnapshot(t, actions, stored === "chargement" ? forecast : stored, mode) : snapshot;
  return (
    <div className="tr-home">
      <header className="aq-bar tr-home-bar">
        <span className="tr-brand">
          <BrandMark />
          <span className="tr-brand-name">
            Territoire <span className="tr-brand-city">· Trois-Rivières</span>
          </span>
          <span className="tr-badge" title="Démo non officielle : données ouvertes réelles et données simulées.">
            Démo
          </span>
        </span>
        <span className="aq-spacer" />
        <AlertBell alerts={snap.alerts} current={null} />
        <Link href="/a-propos" className="tr-about tr-iconbtn" aria-label="À propos de la démo" title="À propos">
          <UiIcon name="info" size={18} />
        </Link>
      </header>
      <main className="tr-home-main">
        <div className="tr-home-head">
          <div>
            <h1>
              Vue d&apos;ensemble · <span className="tr-home-stamp">{snap.stamp}</span>
            </h1>
            <p className="tr-home-lede">
              Gestion du territoire de Trois-Rivières à l&apos;heure simulée{hydrated && speed === 60 ? " (accélérée ×60)" : ""}. Les alertes et
              l&apos;état des services suivent l&apos;horloge commune et vos décisions dans les vues 3D.
            </p>
          </div>
          <span className="tr-sim tr-home-badge">Simulation · Démo non officielle</span>
        </div>
        <div className="tr-home-top">
          <div className="tr-home-main-col">
            <AlertsPanel alerts={snap.alerts} summary={snap.summary} />
            <NextEvents next={snap.next} />
          </div>
          <div className="tr-home-side">{weather}</div>
        </div>
        <section className="tr-home-envs" aria-labelledby="tr-envs-h">
          <h2 id="tr-envs-h">Environnements</h2>
          <ul className="tr-envcards">
            {snap.envs.map((e, i) => (
              <EnvCard key={e.id} env={e} eager={i < 2} />
            ))}
          </ul>
          {/* les vignettes sont de vraies captures : leurs sources sont créditées ici, sans JavaScript */}
          <p className="tr-envcards-credit">{THUMBS_CREDIT}</p>
        </section>
      </main>
      <footer className="tr-home-foot">
        <p>
          Démo non officielle · données ouvertes CC-BY 4.0 · <Link href="/a-propos">À propos</Link>
        </p>
      </footer>
    </div>
  );
}
