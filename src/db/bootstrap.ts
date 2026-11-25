import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./client";

export async function runMigrations(folder = path.join(process.cwd(), "drizzle")) {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL manquant");
  await migrate(db, { migrationsFolder: folder });
}
