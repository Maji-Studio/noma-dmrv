import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./auth";
import { creditBatches } from "./credits";
import { certificationSubmissions, certifierRemovals } from "./certification";
import { removalTemplateObservations } from "./removal-template-observations";
import type { TemplateInput } from "@/lib/isometric/template-observations/types";

export interface MassDistanceDetail {
  mass: { magnitude: string; unit: string };
  distance: { magnitude: string; unit: string };
}
export const emissionEntries = pgTable(
  "emission_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    creditBatchId: uuid("credit_batch_id").notNull(),
    removalTemplateId: text("removal_template_id").notNull(),
    componentId: text("component_id").notNull(),
    inputShape: jsonb("input_shape").$type<TemplateInput[]>().notNull(),
    lineRule: text("line_rule", { enum: ["additive", "single"] }).notNull(),
    observationId: uuid("observation_id").notNull(),
    kind: text("kind", { enum: ["value", "zero"] }).notNull(),
    confirmedForRemovalId: uuid("confirmed_for_removal_id"),
    occurredOn: date("occurred_on").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id),
    version: integer("version").notNull().default(1),
    contentRevision: integer("content_revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    sentByRemovalId: uuid("sent_by_removal_id"),
    sendReservedBySubmissionId: uuid("send_reserved_by_submission_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("emission_entries_id_org_unique").on(t.id, t.organizationId),
    index("emission_entries_org_batch_idx").on(t.organizationId, t.creditBatchId),
    foreignKey({
      columns: [t.creditBatchId, t.organizationId],
      foreignColumns: [creditBatches.id, creditBatches.organizationId],
    }),
    foreignKey({
      columns: [t.observationId, t.organizationId],
      foreignColumns: [removalTemplateObservations.id, removalTemplateObservations.organizationId],
    }),
    foreignKey({
      columns: [t.sentByRemovalId, t.organizationId],
      foreignColumns: [certifierRemovals.id, certifierRemovals.organizationId],
    }),
    foreignKey({
      columns: [t.confirmedForRemovalId, t.organizationId],
      foreignColumns: [certifierRemovals.id, certifierRemovals.organizationId],
    }),
    foreignKey({
      columns: [t.sendReservedBySubmissionId, t.organizationId],
      foreignColumns: [certificationSubmissions.id, certificationSubmissions.organizationId],
    }),
    uniqueIndex("emission_entries_single_value_unique")
      .on(t.creditBatchId, t.removalTemplateId, t.componentId)
      .where(sql`${t.lineRule} = 'single' and ${t.kind} = 'value' and ${t.deletedAt} is null`),
    uniqueIndex("emission_entries_confirmed_zero_unique")
      .on(t.confirmedForRemovalId, t.creditBatchId, t.componentId)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("emission_entries_operator_zero_unique")
      .on(t.organizationId, t.creditBatchId, t.componentId)
      .where(sql`${t.kind} = 'zero' and ${t.confirmedForRemovalId} is null and ${t.deletedAt} is null`),
    check("emission_entries_kind", sql`${t.kind} in ('value', 'zero')`),
    check("emission_entries_rule", sql`${t.lineRule} in ('additive', 'single')`),
    check(
      "emission_entries_zero_owner",
      sql`(${t.kind} = 'value' and ${t.confirmedForRemovalId} is null) or ${t.kind} = 'zero'`,
    ),
    check("emission_entries_revisions", sql`${t.version} > 0 and ${t.contentRevision} > 0`),
  ],
);
export const emissionEntryValues = pgTable(
  "emission_entry_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    entryId: uuid("entry_id").notNull(),
    inputKey: text("input_key").notNull(),
    magnitude: numeric("magnitude").notNull(),
    unit: text("unit").notNull(),
    massDistanceDetail: jsonb("mass_distance_detail").$type<MassDistanceDetail>(),
  },
  (t) => [
    unique("emission_entry_values_input_unique").on(t.entryId, t.inputKey),
    foreignKey({
      columns: [t.entryId, t.organizationId],
      foreignColumns: [emissionEntries.id, emissionEntries.organizationId],
    }),
    check(
      "emission_entry_values_nonnegative",
      sql`${t.magnitude} >= 0 and ${t.magnitude} <> 'NaN'::numeric and ${t.magnitude} <> 'Infinity'::numeric`,
    ),
  ],
);
