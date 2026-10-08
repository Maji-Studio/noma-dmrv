import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { members, organizations, users } from "./auth";

/** Better Auth 1.7.7 apikey model. referenceId always references an organization. */
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  configId: text("config_id").notNull().default("default"),
  name: text("name"),
  start: text("start"),
  prefix: text("prefix"),
  referenceId: text("reference_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at"),
  enabled: boolean("enabled").notNull().default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(false),
  rateLimitTimeWindow: integer("rate_limit_time_window"),
  rateLimitMax: integer("rate_limit_max"),
  requestCount: integer("request_count").notNull().default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  permissions: text("permissions"),
  metadata: text("metadata"),
}, (table) => [
  index("api_keys_key_idx").on(table.key),
  index("api_keys_reference_id_idx").on(table.referenceId),
  index("api_keys_config_id_idx").on(table.configId),
  index("api_keys_expires_at_idx").on(table.expiresAt),
]);

/** Authority is server-owned, never plugin metadata. Missing owner fails closed. */
export const apiKeyOwners = pgTable("api_key_owners", {
  credentialId: text("credential_id").primaryKey()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  memberId: text("member_id")
    .references(() => members.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  revokedAt: timestamp("revoked_at"),
  revocationReason: text("revocation_reason"),
}, (table) => [index("api_key_owners_org_user_idx").on(table.organizationId, table.userId)]);

export type ApiKeyRecord = typeof apiKeys.$inferSelect;

export type ApiKeyOwner = typeof apiKeyOwners.$inferSelect;
