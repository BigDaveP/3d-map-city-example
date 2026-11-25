"use client";
/**
 * Marquage d'une zone de stationnement de nuit : son nom, l'état de l'interdiction (ou rien) et un
 * seul chiffre (avancement pendant l'interdiction, sinon le nombre de feux et leur état). Au sol
 * dans la scène (`drawable`, surface HTML-in-Canvas), étiquette plate en mode classique. Bouton :
 * focusable au clavier, il ouvre la fiche de la zone.
 */
import type { ZoneId } from "@/lib/territoire/day";
import type { ZonePlan } from "@/lib/territoire/neige";
import { banLine, markFigure } from "./labels";
import { selectSnow, useSnowSelection } from "./state";

/** Taille de la surface au sol (px CSS). */
export const MARK_SIZE = { w: 420, h: 124 } as const;
export const markKey = (zone: ZoneId) => `zone:${zone}`;

export function ZoneMark({ plan, name, lights, drawable }: { plan: ZonePlan; name: string; lights: number; drawable?: boolean }) {
  const sel = useSnowSelection();
  const selected = sel?.kind === "zone" && sel.id === plan.zone;
  const state = banLine(plan);
  const fig = markFigure(plan, lights);
  const scene = drawable ? { "data-panel": markKey(plan.zone), drawable: "", style: { width: MARK_SIZE.w, height: MARK_SIZE.h } } : {};
  return (
    <button
      type="button"
      className="dn-mark"
      data-ban={plan.ban}
      aria-pressed={selected}
      aria-label={`${name} : ${state ?? "aucune interdiction"}, ${fig.value} ${fig.label} (simulé). Ouvrir la fiche.`}
      onClick={() => selectSnow({ kind: "zone", id: plan.zone })}
      {...scene}
    >
      <span className="dn-mark-name">{name}</span>
      {state && <span className="dn-mark-state">{state}</span>}
      <span className="dn-mark-fig">
        <span className="aq-num">{fig.value}</span> {fig.label}
      </span>
    </button>
  );
}
