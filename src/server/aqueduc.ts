/** Modèle d'aqueduc côté serveur : lu une fois, puis actions d'intervention (Simulation). */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CITY } from "@/lib/aqueduc/city";
import { isolate, type Isolation } from "@/lib/aqueduc/graph";
import { decodeNetwork, segmentsInBox, type RawNetwork } from "@/lib/aqueduc/network";
import { buildModel, type Model } from "@/lib/aqueduc/sim";

const g = globalThis as unknown as { __aqueducModel?: Model; __aqueducDemo?: number[] };

export function getModel(): Model {
  if (!g.__aqueducModel) {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), "data", "aqueduc", "trois-rivieres.json"), "utf8")) as RawNetwork;
    g.__aqueducModel = buildModel(decodeNetwork(raw), CITY);
  }
  return g.__aqueducModel;
}

/** Segments de la zone du démo, dans l'ordre des tableaux `p` et `q` du flux. */
export function getDemoSegments(): number[] {
  return (g.__aqueducDemo ??= segmentsInBox(getModel().network, CITY.demoBox));
}

export interface Notice {
  sectorId: string;
  kind: "ebullition" | "interruption";
  text: string;
  addresses: number;
}

export type CloseResult = { ok: true; isolation: Isolation } | { ok: false; reason: string };

/** Ferme des vannes : refuse tout nœud qui n'isole pas ce tronçon. Sans état, donc idempotent. */
export function closeValves(segmentId: string, nodes: number[]): CloseResult {
  const m = getModel();
  const seg = m.network.byId.get(segmentId);
  if (seg === undefined) return { ok: false, reason: `Tronçon inconnu : ${segmentId}` };
  const isolation = isolate(m.network, seg, m.valves);
  const allowed = new Set(isolation.valves);
  const foreign = nodes.filter((v) => !allowed.has(v));
  if (foreign.length) return { ok: false, reason: `Vanne étrangère à l'isolement de ${segmentId} : ${foreign.join(", ")}` };
  return { ok: true, isolation };
}

/** Avis à la population (Simulation) pour un secteur ; sans état, donc idempotent. */
export function publishNotice(sectorId: string, kind: Notice["kind"]): Notice {
  const sector = getModel().sectors.find((s) => s.id === sectorId);
  if (!sector) throw new Error(`Secteur inconnu : ${sectorId}`);
  const what =
    kind === "ebullition"
      ? "Avis d'ébullition préventif : faites bouillir l'eau une minute avant de la consommer."
      : "Interruption du service d'eau pour travaux : prévoyez des réserves d'eau.";
  return {
    sectorId,
    kind,
    addresses: sector.addresses,
    text: `Simulation · ${sector.name} · ${what} ${sector.addresses} adresses visées.`,
  };
}
