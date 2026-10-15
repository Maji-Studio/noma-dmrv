/**
 * Append-only activity history, value-free in v1: changed fields hold names only.
 * Written inside the caller's transaction. Entity references have no FKs so
 * history survives deletes as tombstones. The writer checks facility ownership
 * without row locks so activity does not join the facility archive lock order.
 */
import { sql } from "drizzle-orm";
import { bigserial, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./auth";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, ACTIVITY_SOURCES, ACTORLESS_ACTIVITY_SOURCES } from "./common";

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  facilityId: uuid("facility_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 3 }).notNull().default(sql`clock_timestamp()`),
  sequence: bigserial("sequence", { mode: "bigint" }).notNull().unique(),
  entityType: text("entity_type", { enum: ACTIVITY_ENTITY_TYPES }).notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action", { enum: ACTIVITY_ACTIONS }).notNull(),
  changedFields: text("changed_fields").array().notNull().default(sql`'{}'::text[]`),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  fromRemote: text("from_remote"),
  toRemote: text("to_remote"),
  submissionRef: jsonb("submission_ref").$type<{
    provider: string;
    submissionType: string;
    submissionId: string;
    version: number;
  }>(),
  creditBatchId: uuid("credit_batch_id"),
  productionRunId: uuid("production_run_id"),
  source: text("source", { enum: ACTIVITY_SOURCES }).notNull(),
  actorUserId: text("actor_user_id"),
  credentialId: text("credential_id"),
  requestId: text("request_id"),
  registryAt: timestamp("registry_at", { withTimezone: true, precision: 3 }),
  reasonCode: text("reason_code"),
}, (table) => [
  index("activity_events_org_entity_occurred_sequence_idx").on(
    table.organizationId, table.entityType, table.entityId, table.occurredAt, table.sequence,
  ),
  index("activity_events_org_batch_occurred_sequence_idx").on(
    table.organizationId, table.creditBatchId, table.occurredAt, table.sequence,
  ),
  index("activity_events_org_run_occurred_sequence_idx").on(
    table.organizationId, table.productionRunId, table.occurredAt, table.sequence,
  ),
  index("activity_events_org_occurred_idx").on(table.organizationId, table.occurredAt),
  check("activity_events_entity_type", sql`${table.entityType} in (${sql.join(
    ACTIVITY_ENTITY_TYPES.map((entityType) => sql.raw(`'${entityType}'`)), sql`, `,
  )})`),
  check("activity_events_action", sql`${table.action} in (${sql.join(
    ACTIVITY_ACTIONS.map((action) => sql.raw(`'${action}'`)), sql`, `,
  )})`),
  check("activity_events_source", sql`${table.source} in (${sql.join(
    ACTIVITY_SOURCES.map((source) => sql.raw(`'${source}'`)), sql`, `,
  )})`),
  check("activity_events_actor", sql`${table.actorUserId} is not null or ${table.source} in (${sql.join(
    ACTORLESS_ACTIVITY_SOURCES.map((source) => sql.raw(`'${source}'`)), sql`, `,
  )})`),
  check("activity_events_status_target", sql`${table.action} <> 'status_changed' or ${table.toStatus} is not null or ${table.toRemote} is not null`),
]);
