"use server";
/** Server Actions : écritures déclenchées depuis les cartes (note, responsable, alerte). */
import * as repo from "@/server/repo";

export async function saveNoteAction(cardId: string, body: string) {
  return repo.saveNote(cardId, String(body ?? ""));
}

export async function assignAction(cardId: string, managerId: number) {
  return repo.assignManager(cardId, Number(managerId));
}

export async function createAlertAction(cardId: string, level: 1 | 2, message: string) {
  return repo.createAlert(cardId, level === 2 ? 2 : 1, String(message ?? ""));
}
