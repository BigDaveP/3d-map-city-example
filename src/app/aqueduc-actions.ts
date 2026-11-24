"use server";
import { closeValves, publishNotice, type CloseResult, type Notice } from "@/server/aqueduc";

export async function closeValvesAction(segmentId: string, nodes: number[]): Promise<CloseResult> {
  return closeValves(segmentId, Array.isArray(nodes) ? nodes.filter((v) => Number.isInteger(v)) : []);
}

export async function publishNoticeAction(sectorId: string, kind: Notice["kind"]): Promise<{ ok: true; notice: Notice }> {
  if (kind !== "ebullition" && kind !== "interruption") throw new Error("Type d'avis inconnu");
  return { ok: true, notice: publishNotice(String(sectorId), kind) };
}
