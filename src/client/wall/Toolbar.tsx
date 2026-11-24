"use client";
import { useStore } from "zustand";
import { uiStore, type Mode } from "../ui";

export interface ToolbarActions {
  setMode(m: Mode): void;
  setSpeed(s: 1 | 10 | 100): void;
  storm(): void;
  setCount(n: number): void;
  fitAll(): void;
}

export function Toolbar({ actions, n, persistence, asideOpen, toggleAside }: { actions: ToolbarActions; n: number; persistence: string; asideOpen: boolean; toggleAside(): void }) {
  const ui = useStore(uiStore);
  return (
    <div className="toolbar" role="toolbar" aria-label="Commandes du mur">
      <button type="button" onClick={toggleAside} aria-pressed={asideOpen} title="Vue d'ensemble SSR">
        ☰
      </button>
      <div className="grp" role="group" aria-label="Mode de rendu">
        <button type="button" aria-pressed={ui.mode === "dom"} onClick={() => actions.setMode("dom")}>
          Mode DOM
        </button>
        <button type="button" aria-pressed={ui.mode === "canvas"} onClick={() => actions.setMode("canvas")} disabled={ui.api === "absente"}>
          Mode HTML-in-Canvas
        </button>
      </div>
      <span className={`badge ${ui.api}`} title={ui.apiDetail} data-testid="api-badge">
        API {ui.api === "active" ? "active et vérifiée" : ui.api}
      </span>
      <label>
        Cartes
        <select value={n} onChange={(e) => actions.setCount(Number(e.currentTarget.value))}>
          {[250, 500, 1000, 2500, 5000].map((v) => (
            <option key={v} value={v}>
              {v > 1000 ? `${v} (extrapolation)` : v}
            </option>
          ))}
        </select>
      </label>
      <div className="grp" role="group" aria-label="Vitesse des données">
        {([1, 10, 100] as const).map((s) => (
          <button key={s} type="button" aria-pressed={ui.speed === s} onClick={() => actions.setSpeed(s)}>
            ×{s}
          </button>
        ))}
      </div>
      <button type="button" className="storm" onClick={actions.storm}>
        Tempête
      </button>
      <label title="Nombre maximal de captures HTML par frame">
        Captures/frame
        <input type="range" min={1} max={64} value={ui.maxCaptures} onChange={(e) => uiStore.setState({ maxCaptures: Number(e.currentTarget.value) })} />
        <output>{ui.maxCaptures}</output>
      </label>
      <label title="Budget de temps de capture par frame">
        ms/frame
        <input type="range" min={0.5} max={16} step={0.5} value={ui.maxMs} onChange={(e) => uiStore.setState({ maxMs: Number(e.currentTarget.value) })} />
        <output>{ui.maxMs}</output>
      </label>
      <label title="Atlas de textures (plusieurs cartes par texture) ou une texture par carte">
        <input type="checkbox" checked={ui.atlas} onChange={(e) => uiStore.setState({ atlas: e.currentTarget.checked })} /> Atlas
      </label>
      <button type="button" onClick={actions.fitAll}>
        Vue d&apos;ensemble
      </button>
      <button type="button" aria-pressed={ui.robotOpen} onClick={() => uiStore.setState({ robotOpen: !ui.robotOpen })}>
        Voir ce que voit un robot
      </button>
      <span className="badge" title="Persistance des notes">
        {persistence}
      </span>
    </div>
  );
}
