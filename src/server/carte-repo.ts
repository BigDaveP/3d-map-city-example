/** Persistance de la carte : pause, note, livreurs envoyés, réassignations (repli mémoire sans Postgres). */
import "server-only";
import { getDb } from "@/db/client";
import { courierAssignments, restaurantState } from "@/db/schema";
import { COURIERS, RESTAURANTS } from "@/lib/carte/catalog";

export interface RestaurantPersisted {
  paused: boolean;
  note: string;
  dispatched: number;
}

const g = globalThis as unknown as { __carteMem?: { state: Map<string, RestaurantPersisted>; assign: Map<string, string> }; __cartePersistence?: string };
g.__carteMem ??= { state: new Map(), assign: new Map() };
const M = g.__carteMem;

async function withDb<T>(fn: (db: NonNullable<ReturnType<typeof getDb>>) => Promise<T>, fallback: () => T): Promise<T> {
  const db = getDb();
  if (!db) {
    g.__cartePersistence = "mémoire (DATABASE_URL non défini)";
    return fallback();
  }
  try {
    const r = await fn(db);
    g.__cartePersistence = "Postgres";
    return r;
  } catch (e) {
    g.__cartePersistence = `mémoire (${(e as Error).message.slice(0, 120)})`;
    return fallback();
  }
}

export const cartePersistence = () => g.__cartePersistence ?? "Postgres";
export const isRestaurant = (id: unknown): id is string => typeof id === "string" && RESTAURANTS.some((r) => r.id === id);
export const isCourier = (id: unknown): id is string => typeof id === "string" && COURIERS.some((c) => c.id === id);

export function listRestaurantState(): Promise<Record<string, RestaurantPersisted>> {
  return withDb(
    async (db) => Object.fromEntries((await db.select().from(restaurantState)).map((r) => [r.restaurantId, { paused: r.paused, note: r.note, dispatched: r.dispatched }])),
    () => Object.fromEntries(M.state),
  );
}

export function listAssignments(): Promise<Record<string, string>> {
  return withDb(
    async (db) => Object.fromEntries((await db.select().from(courierAssignments)).map((r) => [r.courierId, r.restaurantId])),
    () => Object.fromEntries(M.assign),
  );
}

async function upsert(id: string, patch: Partial<RestaurantPersisted>): Promise<RestaurantPersisted> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(restaurantState)
        .values({ restaurantId: id, paused: patch.paused ?? false, note: patch.note ?? "", dispatched: patch.dispatched ?? 0 })
        .onConflictDoUpdate({ target: restaurantState.restaurantId, set: { ...patch, updatedAt: new Date() } })
        .returning();
      return { paused: row.paused, note: row.note, dispatched: row.dispatched };
    },
    () => {
      const cur = M.state.get(id) ?? { paused: false, note: "", dispatched: 0 };
      const next = { ...cur, ...patch };
      M.state.set(id, next);
      return next;
    },
  );
}

export function setPaused(id: string, paused: boolean) {
  if (!isRestaurant(id)) throw new Error("restaurant inconnu");
  return upsert(id, { paused });
}

export function setNote(id: string, note: string) {
  if (!isRestaurant(id)) throw new Error("restaurant inconnu");
  return upsert(id, { note: note.slice(0, 2000) });
}

export async function dispatchCourier(id: string) {
  if (!isRestaurant(id)) throw new Error("restaurant inconnu");
  const cur = (await listRestaurantState())[id];
  return upsert(id, { dispatched: (cur?.dispatched ?? 0) + 1 });
}

export async function reassignCourier(courierId: string) {
  if (!isCourier(courierId)) throw new Error("livreur inconnu");
  const c = COURIERS.find((x) => x.id === courierId)!;
  const assigned = await listAssignments();
  const cur = assigned[courierId] ?? RESTAURANTS[c.restaurant].id;
  // restaurant suivant de la même ville
  const pool = RESTAURANTS.filter((r) => r.city === c.city);
  const next = pool[(pool.findIndex((r) => r.id === cur) + 1) % pool.length].id;
  return withDb(
    async (db) => {
      await db
        .insert(courierAssignments)
        .values({ courierId, restaurantId: next })
        .onConflictDoUpdate({ target: courierAssignments.courierId, set: { restaurantId: next, updatedAt: new Date() } });
      return { courierId, restaurantId: next };
    },
    () => {
      M.assign.set(courierId, next);
      return { courierId, restaurantId: next };
    },
  );
}
