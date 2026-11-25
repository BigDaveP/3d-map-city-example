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
import { ENVS } from "@/lib/territoire/envs";
import { homeSnapshot, type HomeSnapshot, type Mode } from "@/lib/territoire/home";
import type { Forecast } from "@/lib/territoire/meteo";
import { AlertBell } from "../shell/AlertBell";
import { BrandMark } from "../shell/EnvIcon";
import { territoireStore } from "../store";
import { useHydrated, useSimNow, useTerritoire } from "../useTerritoire";
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

  // la prévision lue par le serveur sert aussi aux vues 3D (pas de second appel)
  useEffect(() => {
    if (territoireStore.getState().forecast === "chargement") territoireStore.setState({ forecast });
  }, [forecast]);

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
        <Link href="/a-propos" className="tr-about" aria-label="À propos de la démo" title="À propos">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M10 9v4.5M10 6.4v.1" strokeLinecap="round" />
          </svg>
        </Link>
      </header>
      <main className="tr-home-main">
        <div className="tr-home-head">
          <div>
            <p className="tr-eyebrow">Gestion du territoire · Trois-Rivières</p>
            <h1>
              Vue d&apos;ensemble · <span className="tr-home-stamp">{snap.stamp}</span>
            </h1>
            <p className="tr-home-lede">
              Heure simulée de la journée scénarisée{hydrated && speed === 60 ? ", accélérée ×60" : ""}. Alertes et états suivent l&apos;horloge
              commune et vos décisions dans les vues 3D.
            </p>
          </div>
          <span className="tr-home-badge">Simulation · Démo non officielle</span>
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
            {snap.envs.map((e) => (
              <EnvCard key={e.id} env={e} />
            ))}
          </ul>
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
