"use client";
/**
 * Barre d'application commune : nom de l'outil et mention « Démo » (lien vers l'accueil),
 * environnement courant, recherche (secteurs, zones, conduites, capteurs, ressources, rues des tuiles
 * chargées), bascule Classique / HTML-in-Canvas, cloche des alertes et lien « À propos ». Les
 * indicateurs de performance n'y sont pas.
 *
 * La recherche est une liste déroulante accessible (combobox ARIA) : flèches, Entrée, Échap. Un
 * résultat d'un autre environnement y mène (navigation côté client) et le met en avant (`focus`).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { ENVS, type EnvId } from "@/lib/territoire/envs";
import { hourLabel } from "@/lib/territoire/home";
import { fold, staticHits, type SearchHit } from "@/lib/territoire/search";
import { loadedModules } from "../modules";
import { setFocus, territoireStore, type Mode } from "../store";
import { useLiveAlerts, useTerritoire } from "../useTerritoire";
import { AlertBell } from "./AlertBell";
import { BrandMark, EnvIcon } from "./EnvIcon";

interface Hit {
  key: string;
  label: string;
  kind: string;
  env: EnvId | null;
  go(): void;
}

const MAX_HITS = 10;

/** Noms de rues des tuiles chargées (OpenMapTiles, couche transportation_name). */
function streetHits(map: MlMap | null, q: string): { name: string; at: [number, number] }[] {
  if (!map || q.length < 3) return [];
  const out = new Map<string, [number, number]>();
  for (const f of map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation_name" })) {
    const name = String(f.properties?.name ?? "");
    if (!name || out.has(name) || !fold(name).includes(q)) continue;
    const g = f.geometry;
    const c = g.type === "LineString" ? g.coordinates[Math.floor(g.coordinates.length / 2)] : g.type === "MultiLineString" ? g.coordinates[0][0] : null;
    if (c) out.set(name, [c[0], c[1]]);
    if (out.size >= 4) break;
  }
  return [...out].map(([name, at]) => ({ name, at }));
}

function Search({ map, env }: { map: MlMap | null; env: EnvId | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [msg, setMsg] = useState("");
  const id = useId();

  /** Résultats : éléments des modules chargés (conduites, capteurs), puis connus d'avance, puis rues. */
  function hits(raw: string): Hit[] {
    const toHit = (h: SearchHit): Hit => ({
      key: `${h.focus.env}:${h.focus.kind}:${h.focus.id}`,
      label: h.label,
      kind: h.kind,
      env: h.focus.env,
      go: () => {
        setFocus(h.focus);
        if (h.focus.env !== env) router.push(`/carte/${h.focus.env}${location.search}`, { scroll: false });
      },
    });
    const found = [...loadedModules().flatMap((m) => m.search?.(raw) ?? []), ...staticHits(raw)].map(toHit);
    const streets = streetHits(map, fold(raw)).map(
      (s): Hit => ({ key: `rue:${s.name}`, label: s.name, kind: "Rue", env: null, go: () => map?.easeTo({ center: s.at, zoom: Math.max(map.getZoom(), 16.2), duration: 1200 }) }),
    );
    const seen = new Set<string>();
    return [...found, ...streets].filter((h) => !seen.has(h.key) && seen.add(h.key)).slice(0, MAX_HITS);
  }
  // les rues viennent des tuiles chargées au moment de la saisie ; les modules, de ceux déjà ouverts
  const options = useMemo(() => hits(q), [q, map, env]);

  const pick = (h: Hit) => {
    setOpen(false);
    setActive(-1);
    setMsg("");
    setQ(h.label);
    h.go();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const all = hits(q);
    const chosen = all[active] ?? all.find((h) => fold(h.label) === fold(q)) ?? all[0];
    if (!chosen) return setMsg(`Aucun résultat pour « ${q.trim()} ».`);
    pick(chosen);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (!options.length) return;
    setOpen(true);
    const n = options.length;
    setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
  };

  const expanded = open && options.length > 0;
  return (
    <form className="aq-search tr-search" role="search" onSubmit={submit}>
      <label className="aq-sr" htmlFor={`${id}-in`}>
        Rechercher un secteur, une zone, une conduite, un capteur, une ressource ou une rue
      </label>
      <svg className="tr-search-i" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="m13 13 4 4" strokeLinecap="round" />
      </svg>
      <input
        id={`${id}-in`}
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${id}-o${active}` : undefined}
        aria-describedby={`${id}-hint`}
        value={q}
        placeholder="Secteur, zone, conduite, capteur…"
        onChange={(e) => (setQ(e.target.value), setMsg(""), setOpen(true), setActive(-1))}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={key}
        autoComplete="off"
        spellCheck={false}
      />
      {expanded && (
        <ul id={`${id}-list`} role="listbox" className="tr-search-list" aria-label="Résultats">
          {options.map((h, i) => (
            <li
              key={h.key}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              // avant le blur du champ, qui fermerait la liste
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              <span className="tr-hit-l">{h.label}</span>
              <span className="tr-hit-k">
                {h.kind}
                {h.env && h.env !== env && ` · ${ENVS[h.env].title}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <span id={`${id}-hint`} className={msg ? "aq-search-msg" : "aq-sr"} role="status">
        {msg || "Exemples : 13C1949, P-01, Centre-ville, Zone A, CH-01, rue des Forges"}
      </span>
    </form>
  );
}

/** Cloche des vues 3D : alertes à l'heure simulée, avec les décisions du visiteur ; liens gardant `?mode`. */
function LiveBell({ env }: { env: EnvId | null }) {
  const alerts = useLiveAlerts();
  const items = alerts.map((a) => ({ ...a, time: hourLabel(a.at), href: `/carte/${a.env}${location.search}` }));
  return <AlertBell alerts={items} current={env} />;
}

export function AppBar({ map, env }: { map: MlMap | null; env: EnvId | null }) {
  const mode = useTerritoire((s) => s.mode);
  const api = useTerritoire((s) => s.api);
  // retour manuel à HTML-in-Canvas : la raison d'un repli précédent ne vaut plus (un nouveau repli
  // en écrirait une autre)
  const setMode = (m: Mode) => territoireStore.setState(m === "hic" ? { mode: m, fallback: "" } : { mode: m });
  return (
    <header className="aq-bar">
      <Link href="/" className="tr-brand" title="Vue d'ensemble de la ville">
        <BrandMark />
        <span className="tr-brand-name">
          Territoire <span className="tr-brand-city">· Trois-Rivières</span>
        </span>
        <span className="tr-badge" title="Démo non officielle : données ouvertes réelles et données simulées.">
          Démo
        </span>
        <span className="aq-sr"> : vue d&apos;ensemble</span>
      </Link>
      {env && (
        <span className="tr-crumb">
          <EnvIcon env={env} size={16} />
          <span className="aq-sr">Environnement : </span>
          {ENVS[env].title}
        </span>
      )}
      <Search map={map} env={env} />
      <span className="aq-spacer" />
      <div className="aq-seg" role="group" aria-label="Mode de rendu">
        <button type="button" aria-pressed={mode === "classic"} onClick={() => setMode("classic")}>
          Classique
        </button>
        <button
          type="button"
          aria-pressed={mode === "hic"}
          disabled={api === "absente"}
          title={api === "absente" ? "Votre navigateur n'active pas HTML-in-Canvas" : undefined}
          onClick={() => setMode("hic")}
        >
          HTML-in-Canvas
        </button>
      </div>
      <LiveBell env={env} />
      <Link href="/a-propos" className="tr-about" aria-label="À propos de la démo" title="À propos">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v4.5M10 6.4v.1" strokeLinecap="round" />
        </svg>
      </Link>
    </header>
  );
}
