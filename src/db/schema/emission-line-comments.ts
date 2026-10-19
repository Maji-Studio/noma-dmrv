import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./auth";
import { creditBatches } from "./credits";

/** Noma-only metadata, independent of entry claims and Removal state. */
export const emissionLineComments = pgTable("emission_line_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  creditBatchId: uuid("credit_batch_id").notNull(),
  componentId: text("component_id").notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by").references(() => users.id),
  updatedBy: text("updated_by").references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("emission_line_comments_id_org_unique").on(t.id, t.organizationId),
  unique("emission_line_comments_line_unique").on(t.organizationId, t.creditBatchId, t.componentId),
  foreignKey({
    columns: [t.creditBatchId, t.organizationId],
    foreignColumns: [creditBatches.id, creditBatches.organizationId],
  }).onDelete("cascade"),
  check("emission_line_comments_body_nonempty", sql`length(trim(${t.body})) > 0`),
]);
