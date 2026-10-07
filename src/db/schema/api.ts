/**
 * Data-entry API bookkeeping (docs/plans/2026-10-06-data-entry-api.md).
 *
 * `api_idempotency_records` remembers the committed outcome of a write sent
 * with an idempotency key, so a retry replays it instead of writing twice. The
 * namespace is the credential, not the person: rotating a key starts a new
 * namespace and two integrations owned by one person never collide. A record
 * is inserted at the start of the write's transaction, which is the claim: a
 * concurrent duplicate waits on the uncommitted row and cannot see it.
 */
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./auth";

export const apiIdempotencyRecords = pgTable(
  "api_idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** API key or OAuth grant id. No FK yet: credentials land in Phase 2. */
    credentialId: text("credential_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    operationId: text("operation_id").notNull(),
    /** SHA-256 of operation id, canonical decoded input, target, precondition and API version. */
    fingerprint: text("fingerprint").notNull(),
    /** Transport-neutral outcome; null only inside the claiming transaction. */
    outcome: jsonb("outcome"),
    outcomeSchemaVersion: integer("outcome_schema_version").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    unique("api_idempotency_records_org_credential_key_unique").on(
      table.organizationId,
      table.credentialId,
      table.idempotencyKey,
    ),
    index("api_idempotency_records_expires_at_idx").on(table.expiresAt),
  ],
);
