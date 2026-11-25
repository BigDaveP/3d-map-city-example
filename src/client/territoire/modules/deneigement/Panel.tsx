"use client";
/**
 * Panneau du déneigement : météo (neige des prochaines 36 h et sa source), décision de
 * l'interdiction de stationner pour la nuit en deux gestes (cocher les zones, « Décider pour ce
 * soir »), de jour seulement (07:30 à 15:00), ressources et leur zone, légende des états.
 * Décider pour une zone allume, à 23 h, tous ses feux, sans exception de rue ; la levée se fait
 * seule à 6 h.
 */
import { useId, useState } from "react";
import { ZONES_ATTRIBUTION } from "@/lib/territoire/about";
import { actionsUpTo, type ZoneId } from "@/lib/territoire/day";
import { DEPOTS } from "@/lib/territoire/fleet";
import { banWindow, isDayBan, ZONES, type DeneigementData, type ZonePlan } from "@/lib/territoire/neige";
import { RESOURCE_KIND } from "@/lib/territoire/search";
import { EnvPanel } from "../../shell/EnvPanel";
import { act } from "../../store";
import { useTerritoire } from "../../useTerritoire";
import { decisionLine } from "./labels";
import { selectSnow, useSnowPlans, useSnowSelection } from "./state";
import { WeatherCard } from "./WeatherCard";

const WINDOW_REASON = {
  avant: "Décision de jour, dès la prévision de 7 h 30 (limite 15 h)",
  "trop-tard": "Trop tard pour ce soir (limite 15 h)",
} as const;

/** Zone de chaque ressource selon le plan (null : non assignée). */
function zoneOfResource(plans: readonly ZonePlan[]): Map<string, ZoneId> {
  return new Map(plans.flatMap((p) => p.resources.map((r) => [r, p.zone] as const)));
}

function Decision({ t, plans }: { t: number; plans: readonly ZonePlan[] }) {
  const actions = useTerritoire((s) => s.actions);
  // choix en cours ; null : il suit la décision en vigueur (visiteur ou direction)
  const [picked, setPicked] = useState<ZoneId[] | null>(null);
  const reasonId = useId();
  const win = banWindow(t);
  const open = win === "ouverte";
  const decided = plans.filter((p) => p.ban !== "aucune").map((p) => p.zone);
  const checked = open && picked ? picked : decided;
  // dernière décision du visiteur (même sans zone : « aucune interdiction »), sinon celle de la direction
  const mine = actionsUpTo(actions, t).filter(isDayBan).at(-1);
  const line = mine ? decisionLine({ decidedBy: "visiteur", decidedAt: mine.at }) : decisionLine(plans.find((p) => p.decidedBy !== null) ?? { decidedBy: null, decidedAt: null });
  const toggle = (z: ZoneId, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(z);
    else next.delete(z);
    setPicked(ZONES.filter((x) => next.has(x)));
  };
  const decide = () => {
    act({ kind: "ban", zones: [...checked] });
    setPicked(null);
  };
  return (
    <section className="dn-decide" aria-labelledby="dn-decide-h">
      <h3 id="dn-decide-h" className="dn-h">
        Interdiction de stationner cette nuit
      </h3>
      <fieldset className="dn-zones" disabled={!open}>
        <legend className="dn-sr">Zones visées</legend>
        {ZONES.map((z) => {
          const plan = plans.find((p) => p.zone === z);
          return (
            <label key={z} className="dn-zone-opt" data-ban={plan?.ban}>
              <input type="checkbox" checked={checked.includes(z)} onChange={(e) => toggle(z, e.target.checked)} />
              <span>Zone {z}</span>
            </label>
          );
        })}
      </fieldset>
      <button type="button" className="aq-btn aq-pri dn-decide-btn" disabled={!open} aria-describedby={open ? undefined : reasonId} onClick={decide}>
        Décider pour ce soir
      </button>
      {!open && (
        <p id={reasonId} className="dn-reason" data-win={win}>
          {WINDOW_REASON[win]}
        </p>
      )}
      <p className="dn-decided" aria-live="polite">
        {line ? (
          <>
            {line}
            {mine && mine.zones.length === 0 && " : aucune zone"}
          </>
        ) : (
          "Aucune décision pour ce soir"
        )}
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
        <span className="dn-h">Ressources</span>
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
      <h3 id="dn-legend-h" className="dn-h">
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
          <Decision t={t} plans={plans} />
        </>
      }
    >
      <Resources data={data} plans={plans} />
      <Legend />
    </EnvPanel>
  );
}
