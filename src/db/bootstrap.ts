import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getBranches, MANAGERS, REGIONS } from "../lib/sim/catalog";
import { MAX_CARDS } from "../lib/sim/types";
import { getDb } from "./client";
import { branches, managers, regions } from "./schema";

export async function runMigrations(folder = path.join(process.cwd(), "drizzle")) {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL manquant");
  await migrate(db, { migrationsFolder: folder });
}

/** Seed idempotent : régions, succursales fictives (200, + 800 pour l'extrapolation à 5 000 cartes), responsables. */
export async function seed() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL manquant");
  await db.insert(regions).values(REGIONS.map((r) => ({ id: r.id, name: r.name }))).onConflictDoNothing();
  const all = getBranches(MAX_CARDS);
  await db
    .insert(branches)
    .values(all.map((b) => ({ id: b.id, name: b.name, regionId: b.regionId, target: b.target })))
    .onConflictDoNothing();
  await db.insert(managers).values(MANAGERS).onConflictDoNothing();
  return { regions: REGIONS.length, branches: all.length, managers: MANAGERS.length };
}
