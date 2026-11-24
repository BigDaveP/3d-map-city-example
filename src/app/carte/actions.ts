"use server";
/** Server Actions de la carte : interrupteur de pause, note, envoi et réassignation de livreurs. */
import * as repo from "@/server/carte-repo";

export async function setPausedAction(restaurantId: string, paused: boolean) {
  return repo.setPaused(restaurantId, !!paused);
}
export async function saveRestaurantNoteAction(restaurantId: string, note: string) {
  return repo.setNote(restaurantId, String(note ?? ""));
}
export async function dispatchCourierAction(restaurantId: string) {
  return repo.dispatchCourier(restaurantId);
}
export async function reassignCourierAction(courierId: string) {
  return repo.reassignCourier(courierId);
}
