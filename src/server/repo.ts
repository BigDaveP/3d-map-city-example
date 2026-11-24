/**
 * Accès aux données persistées (notes, assignations, alertes).
 * Si Postgres est indisponible, on bascule sur une mémoire de processus pour que la démo
 * reste utilisable ; l'état « memory » est exposé à l'interface.
 */
import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { alerts, cardAssignments, cardNotes, managers } from "@/db/schema";
import { MANAGERS } from "@/lib/sim/catalog";
import type { Alert, Kind, Manager } from "@/lib/sim/types";
import { KINDS } from "@/lib/sim/types";

export type Persistence = { mode: "postgres" } | { mode: "memory"; reason: string };

const mem = globalThis as unknown as {
  __murMem?: { notes: Map<string, string>; assign: Map<string, number>; alerts: Alert[]; seq: number };
  __murPersistence?: Persistence;
};
mem.__murMem ??= { notes: new Map(), assign: new Map(), alerts: [], seq: 1 };
const M = mem.__murMem;

const CARD_RE = /^(S\d{3}):(sales|staff|reviews|weather|alerts)$/;
export function parseCardId(cardId: unknown): { branchId: string; kind: Kind } | null {
  if (typeof cardId !== "string") return null;
  const m = CARD_RE.exec(cardId);
  return m ? { branchId: m[1], kind: m[2] as Kind } : null;
}
export const isKind = (k: unknown): k is Kind => KINDS.includes(k as Kind);

async function withDb<T>(fn: (db: NonNullable<ReturnType<typeof getDb>>) => Promise<T>, fallback: () => T): Promise<T> {
  const db = getDb();
  if (!db) {
    mem.__murPersistence = { mode: "memory", reason: "DATABASE_URL non défini" };
    return fallback();
  }
  try {
    const r = await fn(db);
    mem.__murPersistence = { mode: "postgres" };
    return r;
  } catch (e) {
    mem.__murPersistence = { mode: "memory", reason: (e as Error).message.slice(0, 160) };
    return fallback();
  }
}

export const persistence = (): Persistence => mem.__murPersistence ?? { mode: "postgres" };

export function listNotes(): Promise<Record<string, string>> {
  return withDb(
    async (db) => Object.fromEntries((await db.select().from(cardNotes)).map((r) => [r.cardId, r.body])),
    () => Object.fromEntries(M.notes),
  );
}

export function listAssignments(): Promise<Record<string, number>> {
  return withDb(
    async (db) => Object.fromEntries((await db.select().from(cardAssignments)).map((r) => [r.cardId, r.managerId])),
    () => Object.fromEntries(M.assign),
  );
}

export function listManagers(): Promise<Manager[]> {
  return withDb(
    async (db) => {
      const rows = await db.select().from(managers).orderBy(managers.id);
      return rows.length ? rows : MANAGERS;
    },
    () => MANAGERS,
  );
}

const toAlert = (r: typeof alerts.$inferSelect): Alert => ({
  id: `m${r.id}`,
  branchId: r.branchId,
  kind: (isKind(r.kind) ? r.kind : "alerts") as Kind,
  level: r.level === 2 ? 2 : 1,
  message: r.message,
  createdAt: r.createdAt.toISOString(),
  source: "manuelle",
});

export function listAlerts(): Promise<Alert[]> {
  return withDb(
    async (db) => (await db.select().from(alerts).where(eq(alerts.resolved, false)).orderBy(desc(alerts.createdAt)).limit(500)).map(toAlert),
    () => [...M.alerts],
  );
}

export function saveNote(cardId: string, body: string): Promise<{ cardId: string; body: string }> {
  const p = parseCardId(cardId);
  if (!p) throw new Error("carte inconnue");
  const text = body.slice(0, 2000);
  return withDb(
    async (db) => {
      await db
        .insert(cardNotes)
        .values({ cardId, branchId: p.branchId, body: text })
        .onConflictDoUpdate({ target: cardNotes.cardId, set: { body: text, updatedAt: new Date() } });
      return { cardId, body: text };
    },
    () => {
      M.notes.set(cardId, text);
      return { cardId, body: text };
    },
  );
}

export function assignManager(cardId: string, managerId: number): Promise<{ cardId: string; managerId: number }> {
  const p = parseCardId(cardId);
  if (!p) throw new Error("carte inconnue");
  if (!Number.isInteger(managerId) || managerId < 1) throw new Error("responsable invalide");
  return withDb(
    async (db) => {
      await db
        .insert(cardAssignments)
        .values({ cardId, branchId: p.branchId, managerId })
        .onConflictDoUpdate({ target: cardAssignments.cardId, set: { managerId, updatedAt: new Date() } });
      return { cardId, managerId };
    },
    () => {
      M.assign.set(cardId, managerId);
      return { cardId, managerId };
    },
  );
}

export function createAlert(cardId: string, level: 1 | 2, message: string): Promise<Alert> {
  const p = parseCardId(cardId);
  if (!p) throw new Error("carte inconnue");
  const msg = message.slice(0, 200) || "Alerte manuelle";
  return withDb(
    async (db) => {
      const [row] = await db.insert(alerts).values({ branchId: p.branchId, kind: p.kind, level, message: msg }).returning();
      return toAlert(row);
    },
    () => {
      const a: Alert = { id: `m${M.seq++}`, branchId: p.branchId, kind: p.kind, level, message: msg, createdAt: new Date().toISOString(), source: "manuelle" };
      M.alerts.unshift(a);
      return a;
    },
  );
}
