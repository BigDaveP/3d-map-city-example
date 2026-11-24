/** Polling (5 s) : état de tous les restaurants (simulation + pause/note persistées). */
import { RESTAURANTS } from "@/lib/carte/catalog";
import { restaurantAt } from "@/lib/carte/sim";
import { cartePersistence, listAssignments, listRestaurantState } from "@/server/carte-repo";
import { json } from "@/server/params";

export const dynamic = "force-dynamic";

export async function GET() {
  const [state, assign] = await Promise.all([listRestaurantState(), listAssignments()]);
  const now = Date.now();
  return json({
    t: now,
    persistence: cartePersistence(),
    restaurants: RESTAURANTS.map((r) => {
      const s = state[r.id];
      return { ...restaurantAt(r.idx, now, !!s?.paused, s?.dispatched ?? 0), note: s?.note ?? "" };
    }),
    assignments: assign,
  });
}
