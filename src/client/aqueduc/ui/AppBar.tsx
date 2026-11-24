"use client";
/**
 * Barre d'application : démos, nom, mention « Simulation », recherche (tronçon, capteur, secteur ou rue),
 * lancement du scénario de bris, horloge simulée, bascule Classique / HTML-in-Canvas et puce de
 * performance. Pendant le scénario, la recherche et le lancement s'effacent (maquette C) : le récit
 * à gauche porte la navigation.
 */
import { useId, useMemo, useState, type FormEvent } from "react";
import type { Map as MlMap } from "maplibre-gl";
import DemoNav from "../../shell/DemoNav";
import type { Metrics } from "../../metrics";
import { clockDay, clockTime } from "../format";
import { fold, lineCenter, segment, type NetIndex } from "../net";
import { startScenario } from "../scenarioController";
import { aqueducStore, select, type Mode } from "../store";
import { useAq, useSimNow } from "../useAq";
import { PerfChip } from "./PerfChip";

interface Hit {
  label: string;
  go: () => void;
}

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
    if (out.size >= 6) break;
  }
  return [...out].map(([name, at]) => ({ name, at }));
}

/** Horloge simulée : seul ce composant se rafraîchit chaque seconde. */
function Clock() {
  const t = useSimNow();
  const speed = useAq((s) => s.clock.speed);
  const scenario = useAq((s) => s.scenario.active);
  return (
    <span className="aq-clock" role="timer" aria-label={`Heure simulée ${clockTime(t)}${speed === 60 ? ", accélérée 60 fois" : ""}`}>
      <span className="aq-clock-day">{scenario ? "Scénario" : clockDay(t)} · </span>
      <b className="aq-num">{clockTime(t)}</b>
      {speed === 60 && <span className="aq-speed">×60</span>}
    </span>
  );
}

export function AppBar({ map, net, metrics }: { map: MlMap | null; net: NetIndex | null; metrics: Metrics | null }) {
  const mode = useAq((s) => s.mode);
  const api = useAq((s) => s.api);
  const scenario = useAq((s) => s.scenario.active);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const listId = useId();
  const hintId = useId();

  const fly = (at: [number, number]) => map?.easeTo({ center: at, zoom: Math.max(map.getZoom(), 16.2), duration: 1200 });

  /** Résultats pour une saisie : tronçons, capteurs, secteurs puis rues des tuiles chargées. */
  function hits(raw: string): Hit[] {
    const f = fold(raw);
    if (!net || f.length < 2) return [];
    const out: Hit[] = [];
    const up = raw.trim().toUpperCase();
    for (const s of net.data.sensors) if (s.id.startsWith(up)) out.push({ label: s.id, go: () => (select({ kind: "sensor", id: s.id }), fly(s.at)) });
    for (const s of net.data.sectors)
      if (fold(s.name).includes(f)) out.push({ label: s.name, go: () => (select({ kind: "sector", id: s.id }), fly(s.at)) });
    let n = 0;
    for (const [id, i] of net.segById) {
      if (n >= 6) break;
      if (!id.startsWith(up)) continue;
      n++;
      out.push({ label: id, go: () => (select({ kind: "segment", id }), fly(lineCenter(segment(net, i)))) });
    }
    for (const s of streetHits(map, f)) out.push({ label: s.name, go: () => fly(s.at) });
    return out.slice(0, 12);
  }

  // `hits` ne dépend que de q, net et map ; les rues viennent des tuiles chargées au moment de la saisie
  const options = useMemo(() => hits(q), [q, net, map]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const all = hits(q);
    const exact = all.find((h) => fold(h.label) === fold(q)) ?? all[0];
    if (!exact) return setMsg(`Aucun résultat pour « ${q.trim()} ».`);
    setMsg("");
    exact.go();
  };

  const setMode = (m: Mode) => aqueducStore.setState({ mode: m });
  return (
    <header className="aq-bar">
      <DemoNav current="aqueduc" />
      <span className="aq-brand">
        <i aria-hidden="true" />
        <span>
          Réseau d&apos;eau potable <span className="aq-city">· Trois-Rivières</span>
        </span>
      </span>
      <span className="aq-sim" title="Capteurs, mesures, secteurs et incidents simulés ; seul le tracé des conduites est réel.">
        Simulation
      </span>
      <form className="aq-search" role="search" onSubmit={submit} hidden={scenario}>
        <label className="aq-sr" htmlFor={`${listId}-in`}>
          Rechercher un tronçon, un capteur, un secteur ou une rue
        </label>
        <input
          id={`${listId}-in`}
          type="search"
          list={listId}
          value={q}
          placeholder="Rue, tronçon, capteur…"
          aria-describedby={hintId}
          onChange={(e) => (setQ(e.target.value), setMsg(""))}
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o.label} value={o.label} />
          ))}
        </datalist>
        <span id={hintId} className={msg ? "aq-search-msg" : "aq-sr"} role="status">
          {msg || "Exemples : 13C1949, P-01, Centre-ville, rue des Forges"}
        </span>
      </form>
      <span className="aq-spacer" />
      {!scenario && (
        <button type="button" className="aq-btn aq-pri aq-launch" disabled={!net} onClick={() => startScenario()}>
          Lancer le scénario de bris
        </button>
      )}
      <Clock />
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
      <PerfChip metrics={metrics} />
    </header>
  );
}
