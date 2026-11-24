import { boolean, index, integer, pgTable, serial, smallint, text, timestamp } from "drizzle-orm/pg-core";

export const regions = pgTable("regions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  regionId: text("region_id").notNull().references(() => regions.id),
  target: integer("target").notNull(),
});

export const managers = pgTable("managers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

/** Note d'équipe par carte (succursale x indicateur). */
export const cardNotes = pgTable("card_notes", {
  cardId: text("card_id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Responsable assigné par carte. */
export const cardAssignments = pgTable("card_assignments", {
  cardId: text("card_id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id),
  managerId: integer("manager_id").notNull().references(() => managers.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Alertes créées manuellement depuis une carte. */
export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    branchId: text("branch_id").notNull().references(() => branches.id),
    kind: text("kind").notNull(),
    level: smallint("level").notNull(),
    message: text("message").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alerts_branch_idx").on(t.branchId)],
);
