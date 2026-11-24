import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;
const g = globalThis as unknown as { __murDb?: { pool: Pool; db: Db } };

/** Connexion paresseuse partagée (survit au HMR). Renvoie null sans DATABASE_URL. */
export function getDb(): Db | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!g.__murDb) {
    const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 2000 });
    pool.on("error", () => {});
    g.__murDb = { pool, db: drizzle(pool, { schema }) };
  }
  return g.__murDb.db;
}

export async function closeDb() {
  await g.__murDb?.pool.end();
  g.__murDb = undefined;
}
