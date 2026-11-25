"use client";
/**
 * Fiche du déneigement, à la sélection : zone (état de l'interdiction, décision, feux par état,
 * ressources assignées, avancement, attribution des zones) ou ressource (type, dépôt, zone assignée,
 * modifiable). Échap ou « × » la referme.
 */
import { useEffect, type ReactNode } from "react";
import { ZONES_ATTRIBUTION } from "@/lib/territoire/about";
import type { ZoneId } from "@/lib/territoire/day";
import { DEPOTS, type Resource } from "@/lib/territoire/fleet";
import { ZONES, type DeneigementData, type ZonePlan } from "@/lib/territoire/neige";
import { RESOURCE_KIND } from "@/lib/territoire/search";
import { UiIcon } from "../../shell/EnvIcon";
import { act } from "../../store";
import { banLine, decisionLine, lightsLabel } from "./labels";
import { selectSnow, useSnowPlans, useSnowSelection } from "./state";
import type { ZoneInfo } from "./Scene";

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="aq-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const TONE = { aucune: "off", programmee: "warn", "en-vigueur": "bad" } as const;
const pct = (x: number) => `${Math.round(x * 100)}\u202f%`;

function Progress({ plan }: { plan: ZonePlan }) {
  if (plan.ban !== "en-vigueur") return <span className="dn-muted">{plan.ban === "programmee" ? "dès 23 h" : "—"}</span>;
  return (
    <span className="dn-progress">
      <span className="dn-bar" role="progressbar" aria-label={`Avancement du déneigement, zone ${plan.zone}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(plan.progress * 100)}>
        <span style={{ width: `${plan.progress * 100}%` }} />
      </span>
      <span className="aq-num">{pct(plan.progress)}</span>
    </span>
  );
}

function ZoneCard({ zone, plan, fleet }: { zone: ZoneInfo; plan: ZonePlan; fleet: readonly Resource[] }) {
  const decided = decisionLine(plan);
  const assigned = fleet.filter((r) => plan.resources.includes(r.id));
  const byKind = (Object.keys(RESOURCE_KIND) as Resource["kind"][]).map((k) => [k, assigned.filter((r) => r.kind === k)] as const).filter(([, rs]) => rs.length > 0);
  return (
    <>
      <header className="aq-insp-h">
        <span className="aq-insp-id">{zone.name}</span>
        <span className="aq-insp-sub">Zone de stationnement de nuit</span>
      </header>
      <p className="aq-insp-status dn-status" data-tone={TONE[plan.ban]}>
        {banLine(plan) ?? "Aucune interdiction ce soir"}
      </p>
      <KV
        rows={[
          ["Décision", decided ?? <span className="dn-muted">aucune</span>],
          ["Feux allumés", <span className="aq-num" key="a">{plan.lights === "allume" ? zone.lights : 0}</span>],
          ["Feux programmés", <span className="aq-num" key="p">{plan.lights === "programme" ? zone.lights : 0}</span>],
          ["Feux éteints", <span className="aq-num" key="e">{plan.lights === "eteint" ? zone.lights : 0}</span>],
          ["Avancement", <Progress plan={plan} key="g" />],
        ]}
      />
      <h3 className="aq-h3">
        Ressources assignées · <span className="aq-num">{assigned.length}</span>
      </h3>
      {byKind.length > 0 ? (
        <ul className="dn-assigned">
          {byKind.map(([k, rs]) => (
            <li key={k}>
              <span className="dn-assigned-k">{RESOURCE_KIND[k]}</span>
              <span className="dn-assigned-ids">
                {rs.map((r) => (
                  <button type="button" key={r.id} className="dn-chip aq-num" onClick={() => selectSnow({ kind: "resource", id: r.id })}>
                    {r.id}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dn-muted">Aucune ressource : le déneigement de la zone n&apos;avance pas.</p>
      )}
      <p className="aq-note">
        Tous les feux de la zone suivent la décision, sans exception de rue ({lightsLabel(zone.lights, plan.lights)}). Levée automatique à 6 h. Feux,
        ressources et avancement : Simulation.
      </p>
      <p className="aq-note dn-credit">{ZONES_ATTRIBUTION}</p>
    </>
  );
}

function ResourceCard({ r, zoneOf, plans }: { r: Resource; zoneOf: ZoneId | null; plans: readonly ZonePlan[] }) {
  const plan = plans.find((p) => p.zone === zoneOf);
  return (
    <>
      <header className="aq-insp-h">
        <span className="aq-insp-id aq-num">{r.id}</span>
        <span className="aq-insp-sub">
          {RESOURCE_KIND[r.kind]} · {DEPOTS[r.depot].name}
        </span>
      </header>
      <KV
        rows={[
          [
            "Zone assignée",
            <select key="z" aria-label={`Zone assignée à ${r.id}`} value={zoneOf ?? ""} onChange={(e) => act({ kind: "assign", resource: r.id, zone: (e.target.value || null) as ZoneId | null })}>
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  Zone {z}
                </option>
              ))}
              <option value="">Non assignée</option>
            </select>,
          ],
          ["Interdiction", plan ? (banLine(plan) ?? "aucune ce soir") : "—"],
          ["Avancement de la zone", plan ? <Progress plan={plan} key="g" /> : "—"],
        ]}
      />
      {plan && (
        <p className="aq-note">
          <button type="button" className="dn-link" onClick={() => selectSnow({ kind: "zone", id: plan.zone })}>
            Ouvrir la fiche de la zone {plan.zone}
          </button>
        </p>
      )}
      <p className="aq-note">Ressource et dépôt : Simulation. Réaffectation possible jour et nuit.</p>
    </>
  );
}

export function SnowInspector({ data, zones }: { data: DeneigementData; zones: readonly ZoneInfo[] }) {
  const sel = useSnowSelection();
  const { plans } = useSnowPlans();
  useEffect(() => {
    if (!sel) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) selectSnow(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [sel]);
  if (!sel) return null;
  let body: ReactNode = null;
  if (sel.kind === "zone") {
    const zone = zones.find((z) => z.id === sel.id);
    const plan = plans.find((p) => p.zone === sel.id);
    if (zone && plan) body = <ZoneCard zone={zone} plan={plan} fleet={data.fleet} />;
  } else {
    const r = data.fleet.find((x) => x.id === sel.id);
    if (r) body = <ResourceCard r={r} zoneOf={plans.find((p) => p.resources.includes(r.id))?.zone ?? null} plans={plans} />;
  }
  if (!body) return null;
  return (
    <aside className="aq-inspector aq-panel dn-inspector" aria-label="Fiche de l'élément sélectionné" data-testid="inspector">
      <button type="button" className="aq-close" aria-label="Fermer la fiche" onClick={() => selectSnow(null)}>
        <UiIcon name="close" />
      </button>
      {body}
    </aside>
  );
}
