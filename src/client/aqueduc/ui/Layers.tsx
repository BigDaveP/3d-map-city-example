"use client";
/** Panneau de l'aqueduc : scénario de bris, couches repliables et légende de la couche active. */
import { FLUSHING_2026 } from "@/lib/aqueduc/sim";
import { EnvPanel } from "../../territoire/shell/EnvPanel";
import { num } from "../format";
import { FLUSH_COLORS, NO_DATA, PIPE_STOPS } from "../pipes";
import { TUBE_DEPTH_M, TUBE_EXAGGERATION } from "../scene/tubes";
import { startScenario } from "../scenarioController";
import { aqueducStore, type LayerId } from "../store";
import { useAq } from "../useAq";

const LAYERS: { id: LayerId; label: string; swatch: string }[] = [
  { id: "pression", label: "Pression", swatch: "#2f9bd6" },
  { id: "qualite", label: "Qualité de l'eau", swatch: "#1c8a4a" },
  { id: "age", label: "Âge des conduites", swatch: "#8a6d3b" },
  { id: "rincage", label: "Rinçage 2026", swatch: "#7a5cd6" },
  { id: "incidents", label: "Incidents", swatch: "#d23b2b" },
];

const gradient = (stops: readonly (readonly [number, string])[]) => {
  const a = stops[0][0];
  const b = stops[stops.length - 1][0];
  return `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${Math.round(((v - a) / (b - a)) * 100)}%`).join(", ")})`;
};

const MONTH = new Intl.DateTimeFormat("fr-CA", { month: "short", timeZone: "UTC" });

function Legend({ layer }: { layer: LayerId }) {
  if (layer === "pression" || layer === "qualite") {
    const { stops, unit } = PIPE_STOPS[layer];
    return (
      <div className="aq-legend">
        <div className="aq-ramp" style={{ background: gradient(stops) }} />
        <div className="aq-ramp-l aq-num">
          {stops.map(([v]) => (
            <span key={v}>{num(v, v < 1 ? 2 : 1)}</span>
          ))}
        </div>
        <p>
          {layer === "pression" ? "Pression simulée en bar" : `Chlore résiduel simulé en ${unit}, norme ≥ 0,2`}.{" "}
          <span className="aq-key" style={{ background: NO_DATA }} /> hors zone suivie.
        </p>
      </div>
    );
  }
  if (layer === "age") {
    const { stops } = PIPE_STOPS.age;
    return (
      <div className="aq-legend">
        <div className="aq-ramp" style={{ background: gradient(stops) }} />
        <div className="aq-ramp-l aq-num">
          {stops.filter((_, i) => i % 2 === 0).map(([v]) => (
            <span key={v}>{v}</span>
          ))}
        </div>
        <p>Année d&apos;installation (données de la Ville). Le matériau est dans la fiche.</p>
      </div>
    );
  }
  if (layer === "rincage") {
    const first = FLUSHING_2026[0];
    const last = FLUSHING_2026[FLUSHING_2026.length - 1];
    return (
      <div className="aq-legend">
        <div className="aq-ramp" style={{ background: `linear-gradient(90deg, ${FLUSH_COLORS[0]}, ${FLUSH_COLORS[FLUSH_COLORS.length - 1]})` }} />
        <div className="aq-ramp-l">
          <span>{MONTH.format(new Date(first.start))}</span>
          <span>{MONTH.format(new Date(last.end))}</span>
        </div>
        <p>Campagne simulée : un secteur toutes les deux semaines.</p>
      </div>
    );
  }
  return (
    <div className="aq-legend">
      <ul className="aq-keys">
        {PIPE_STOPS.incidents.stops.map(([v, c]) => (
          <li key={v}>
            <span className="aq-key" style={{ background: c }} />
            {v === 0 ? "aucun bris" : v === 1 ? "1 ou 2 bris" : "3 bris et plus"}
          </li>
        ))}
      </ul>
      <p>Bris antérieurs simulés depuis 2009 ; l&apos;incident en cours est en rouge.</p>
    </div>
  );
}

/**
 * Panneau de l'aqueduc : l'opération (scénario de bris), puis les couches, la vue souterraine et la
 * légende de la couche active. Pendant le scénario, le récit prend sa place (une chose à la fois).
 */
export function Layers() {
  const layer = useAq((s) => s.layer);
  const underground = useAq((s) => s.underground);
  const all = useAq((s) => s.undergroundAll);
  const tubesError = useAq((s) => s.undergroundError);
  const incidents = useAq((s) => (s.incident ? 1 : 0));
  const scenario = useAq((s) => s.scenario.active);
  if (scenario) return null;
  return (
    <EnvPanel
      env="aqueduc"
      className="aq-layers"
      subtitle="Conduites réelles · capteurs et bris simulés"
      // panneau replié : la vue souterraine garde son facteur d'exagération à l'écran
      collapsedHint={underground && !tubesError && <em className="aq-under-x"> · souterrain ×{TUBE_EXAGGERATION}</em>}
      operations={
        <>
          <button type="button" className="aq-btn aq-pri aq-launch" onClick={() => startScenario()}>
            Lancer le scénario de bris
          </button>
          <p className="tr-envpanel-help">Bris de 14 h au centre-ville, en 5 étapes (simulation)</p>
        </>
      }
    >
      <h3 className="aq-h3 tr-h3">Couches</h3>
      <fieldset className="aq-layer-list">
        <legend className="aq-sr">Couleur des conduites</legend>
        {LAYERS.map((l) => (
          <label key={l.id} className="aq-layer" data-on={layer === l.id || undefined}>
            <input type="radio" name="aq-layer" value={l.id} checked={layer === l.id} onChange={() => aqueducStore.setState({ layer: l.id })} />
            <span className="aq-key" style={{ background: l.swatch }} />
            {l.label}
            {l.id === "incidents" && incidents > 0 && <em className="aq-num">{incidents}</em>}
          </label>
        ))}
      </fieldset>
      <div className="aq-under">
        <button type="button" className="aq-btn aq-under-btn" aria-pressed={underground} onClick={() => aqueducStore.setState({ underground: !underground })}>
          Vue souterraine
        </button>
        {underground && !tubesError && (
          <label className="aq-under-all">
            <input type="checkbox" checked={all} onChange={(e) => aqueducStore.setState({ undergroundAll: e.target.checked })} />
            Tout le réseau
          </label>
        )}
        {underground && (
          <p className="aq-under-note" role="status" data-tone={tubesError ? "bad" : undefined} title={tubesError || undefined}>
            {tubesError
              ? "Vue souterraine indisponible : ce navigateur refuse les tubes 3D (WebGL). Les conduites restent tracées au sol."
              : <>Diamètres exagérés ×{TUBE_EXAGGERATION} · axe à {TUBE_DEPTH_M}&nbsp;m, plus bas pour les grosses conduites</>}
          </p>
        )}
      </div>
      <Legend layer={layer} />
    </EnvPanel>
  );
}
