"use server";
import { closeValves, publishNotice, type CloseResult, type Notice } from "@/server/aqueduc";

/**
 * Fermeture des vannes du scénario. Les arguments viennent du client : un tableau d'entiers est
 * exigé (rien n'est écarté en silence), et `closeValves` exige exactement les vannes du plan
 * d'isolation du serveur.
 */
export async function closeValvesAction(segmentId: unknown, nodes: unknown): Promise<CloseResult> {
  if (typeof segmentId !== "string") return { ok: false, reason: "Tronçon invalide : un identifiant texte est attendu." };
  if (!Array.isArray(nodes)) return { ok: false, reason: "Vannes invalides : une liste de nœuds est attendue." };
  const bad = nodes.filter((v) => !Number.isInteger(v));
  if (bad.length) return { ok: false, reason: `Vannes invalides : nœuds non entiers (${bad.map((v) => JSON.stringify(v) ?? String(v)).join(", ")}).` };
  return closeValves(segmentId, nodes as number[]);
}

export async function publishNoticeAction(sectorId: string, kind: Notice["kind"]): Promise<{ ok: true; notice: Notice }> {
  if (kind !== "ebullition" && kind !== "interruption") throw new Error("Type d'avis inconnu");
  return { ok: true, notice: publishNotice(String(sectorId), kind) };
}
