import { foreignKey, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./auth";
import { creditBatches } from "./credits";

/** UUID document owner for a component's From records proof on one credit batch. */
export const emissionLineFiles = pgTable("emission_line_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  creditBatchId: uuid("credit_batch_id").notNull(),
  componentId: text("component_id").notNull(),
  createdBy: text("created_by").references(() => users.id),
  updatedBy: text("updated_by").references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("emission_line_files_id_org_unique").on(t.id, t.organizationId),
  unique("emission_line_files_component_unique").on(t.organizationId, t.creditBatchId, t.componentId),
  foreignKey({ columns: [t.creditBatchId, t.organizationId],
    foreignColumns: [creditBatches.id, creditBatches.organizationId] }).onDelete("cascade"),
]);
