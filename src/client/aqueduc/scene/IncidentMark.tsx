"use client";
/**
 * Marquage de l'incident en cours : « BRIS PROBABLE », la conduite et une valeur clé (pression du
 * tronçon reçue du flux). Écrit au sol le long de la rue dans la scène (`drawable`), étiquette plate
 * en mode classique.
 */
import type { PipeClass } from "@/lib/aqueduc/network";
import { useThrottled } from "../../hic3d/useThrottled";
import { MATERIAL, num } from "../format";
import { segment, type NetIndex } from "../net";
import { select } from "../store";
import { useAq } from "../useAq";
import { SURFACE_SIZE, surfaceKey } from "./marks";

const CLASS_SHORT: Record<PipeClass, string> = { amenee: "Amenée", maitresse: "Maîtresse", distribution: "Distribution", branchement: "Branchement" };

export function IncidentMark({ net, id, drawable }: { net: NetIndex; id: string; drawable?: boolean }) {
  const idx = net.segById.get(id)!;
  const p = segment(net, idx).properties;
  const pos = net.demoPos.get(idx);
  const raw = useAq((s) => (pos === undefined || !s.live.t ? -1 : s.live.pressure[pos]));
  const pressure = useThrottled(raw);
  const selected = useAq((s) => (s.selection?.kind === "incident" || s.selection?.kind === "segment") && s.selection.id === id);
  // valeur clé : pression du tronçon ; nulle une fois le tronçon isolé
  const key = pressure < 0 ? "…" : pressure === 0 ? "isolée, 0 bar" : `${num(pressure, 1)} bar`;
  // l'identifiant est dans l'étiquette accessible et la fiche ; au sol, la nature de la conduite suffit
  const pipe = `${CLASS_SHORT[p.c]} Ø ${p.d} · ${MATERIAL[p.m].toLowerCase()}${p.y ? ` ${p.y}` : ""}`;
  const scene = drawable ? { "data-panel": surfaceKey("incident", id), drawable: "", style: { width: SURFACE_SIZE.incident.w, height: SURFACE_SIZE.incident.h } } : {};
  return (
    <button
      type="button"
      className="aq-mark aq-mark-incident"
      aria-pressed={selected}
      aria-label={`Bris probable (simulation) sur ${p.id} : ${pipe} ; ${pressure === 0 ? "conduite isolée, 0 bar" : `pression ${key}`}`}
      onClick={() => select({ kind: "incident", id })}
      {...scene}
    >
      <span className="aq-mark-name">BRIS PROBABLE</span>
      <span className="aq-mark-fig">
        {pipe} · <span className="aq-num">{key}</span>
      </span>
    </button>
  );
}
