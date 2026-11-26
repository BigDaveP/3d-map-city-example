"use client";
/**
 * Panneau du déneigement : météo (neige des prochaines 36 h et sa source), décision de
 * l'interdiction de stationner en deux gestes (cocher les zones, décider), ressources et leur zone,
 * légende des états. Décider pour une zone allume, à 23 h, tous ses feux, sans exception de rue ; la
 * levée se fait seule à 6 h. La décision n'est jamais refusée (R11) : après 15 h, une mise en garde ;
 * la nuit, elle change tout de suite la nuit en cours.
 */
import { useId, useState } from "react";
import { ZONES_ATTRIBUTION } from "@/lib/territoire/about";
import type { ZoneId } from "@/lib/territoire/day";
import { DEPOTS } from "@/lib/territoire/fleet";
import { ZONES, type DeneigementData, type ZonePlan } from "@/lib/territoire/neige";
import { RESOURCE_KIND } from "@/lib/territoire/search";
import { UiIcon } from "../../shell/EnvIcon";
import { EnvPanel } from "../../shell/EnvPanel";
import { act } from "../../store";
import { useTerritoire } from "../../useTerritoire";
import { decisionView, type Picked } from "./labels";
import { selectSnow, useSnowPlans, useSnowSelection } from "./state";
import { WeatherCard } from "./WeatherCard";

/** Zone de chaque ressource selon le plan (null : non assignée). */
function zoneOfResource(plans: readonly ZonePlan[]): Map<string, ZoneId> {
  return new Map(plans.flatMap((p) => p.resources.map((r) => [r, p.zone] as const)));
}

function Decision({ t }: { t: number }) {
  const actions = useTerritoire((s) => s.actions);
  // choix en cours, lié à la décision sur laquelle il a commencé ; null : les cases suivent la décision en vigueur
  const [picked, setPicked] = useState<Picked | null>(null);
  const noteId = useId();
  const v = decisionView(t, actions, picked);
  const toggle = (z: ZoneId, on: boolean) => {
    const next = new Set(v.checked);
    if (on) next.add(z);
    else next.delete(z);
    setPicked({ base: v.base, zones: ZONES.filter((x) => next.has(x)) });
  };
  const decide = () => {
    act({ kind: "ban", zones: [...v.checked] });
    setPicked(null);
  };
  const notes = [v.empty, v.caution].filter((x): x is string => x !== null);
  return (
    <section className="dn-decide" aria-labelledby="dn-decide-h">
      <h3 id="dn-decide-h" className="dn-h">
        Interdiction de stationner cette nuit
      </h3>
      <fieldset className="dn-zones">
        <legend className="dn-sr">Zones visées</legend>
        {ZONES.map((z) => (
          <label key={z} className="dn-zone-opt">
            <input type="checkbox" checked={v.checked.includes(z)} onChange={(e) => toggle(z, e.target.checked)} />
            <span>Zone {z}</span>
          </label>
        ))}
      </fieldset>
      <button type="button" className={`aq-btn${v.primary ? " aq-pri" : ""} dn-decide-btn`} data-primary={v.primary || undefined} aria-describedby={notes.length > 0 ? noteId : undefined} onClick={decide}>
        {v.button}
      </button>
      {notes.length > 0 && (
        <p id={noteId} className="dn-caution" data-timing={v.caution ? "oui" : undefined}>
          {notes.join(" ")}
        </p>
      )}
      <p className="dn-decided" aria-live="polite">
        {v.dirty && (
          <span className="dn-dirty">
            Modifications non enregistrées<span aria-hidden="true"> · </span>
          </span>
        )}
        {v.status}
      </p>
    </section>
  );
}

function Resources({ data, plans }: { data: DeneigementData; plans: readonly ZonePlan[] }) {
  const sel = useSnowSelection();
  const zoneOf = zoneOfResource(plans);
  const selected = sel?.kind === "resource" ? sel.id : null;
  return (
    <details className="dn-res" open={selected !== null || undefined}>
      <summary>
        <span className="dn-h">
          <UiIcon name="chevron-right" />
          Ressources
        </span>
        <span className="dn-res-sum">
          {plans.map((p) => (
            <span key={p.zone}>
              {p.zone} <span className="aq-num">{p.resources.length}</span>
            </span>
          ))}
        </span>
      </summary>
      <ul className="dn-res-list">
        {data.fleet.map((r) => {
          const kind = RESOURCE_KIND[r.kind];
          const depot = DEPOTS[r.depot].name.replace(" (simulé)", "");
          return (
            <li key={r.id} data-selected={r.id === selected || undefined}>
              <button type="button" className="dn-res-id aq-num" onClick={() => selectSnow({ kind: "resource", id: r.id })} aria-label={`Fiche de ${r.id}`}>
                {r.id}
              </button>
              <span className="dn-res-k">
                {kind} · {depot}
              </span>
              <select aria-label={`Zone assignée à ${r.id} (${kind}, ${depot})`} value={zoneOf.get(r.id) ?? ""} onChange={(e) => act({ kind: "assign", resource: r.id, zone: (e.target.value || null) as ZoneId | null })}>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    Zone {z}
                  </option>
                ))}
                <option value="">Non assignée</option>
              </select>
            </li>
          );
        })}
      </ul>
      <p className="dn-note">Équipes, chenillettes, niveleuses, souffleuses et camions : Simulation. Réaffectation possible jour et nuit.</p>
    </details>
  );
}

function Legend() {
  return (
    <section className="dn-legend" aria-labelledby="dn-legend-h">
      {/* titre pour les lecteurs d'écran : les pastilles se lisent seules */}
      <h3 id="dn-legend-h" className="dn-sr">
        Légende
      </h3>
      <ul className="dn-legend-row" aria-label="Zones">
        <li>
          <span className="dn-sw" data-ban="aucune" aria-hidden="true" /> Sans interdiction
        </li>
        <li>
          <span className="dn-sw" data-ban="programmee" aria-hidden="true" /> Ce soir
        </li>
        <li>
          <span className="dn-sw" data-ban="en-vigueur" aria-hidden="true" /> En vigueur (23 h – 6 h)
        </li>
      </ul>
      <ul className="dn-legend-row" aria-label="Feux">
        <li>
          <span className="dn-dot" data-lights="eteint" aria-hidden="true" /> Feu éteint
        </li>
        <li>
          <span className="dn-dot" data-lights="programme" aria-hidden="true" /> Programmé
        </li>
        <li>
          <span className="dn-dot" data-lights="allume" aria-hidden="true" /> Allumé (clignote)
        </li>
      </ul>
      <p className="dn-note dn-sim-note">Simulation : feux inspirés du système de la Ville de Québec</p>
      <p className="dn-credit">{ZONES_ATTRIBUTION}</p>
    </section>
  );
}

export function SnowPanel({ data }: { data: DeneigementData }) {
  const { t, plans } = useSnowPlans();
  const tonight = plans.filter((p) => p.ban !== "aucune").length;
  return (
    <EnvPanel
      env="deneigement"
      className="dn-panel"
      subtitle="Zones réelles · feux, ressources et neige simulés"
      collapsedHint={tonight > 0 ? ` · ${tonight} ${tonight > 1 ? "zones" : "zone"} visées` : null}
      operations={
        <>
          <WeatherCard />
          <Decision t={t} />
        </>
      }
      footer={<Legend />}
    >
      <Resources data={data} plans={plans} />
    </EnvPanel>
  );
}
