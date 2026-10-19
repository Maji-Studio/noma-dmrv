import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { TemplateDefinition, TemplateEnrichment } from "@/lib/isometric/template-observations/types";
import type { LineSources } from "@/lib/isometric/template-observations/line-sources";
import { organizations, users } from "./auth";
import { certifierProvider } from "./common";

// Isometric template observations and reviewed component contracts, scoped to an organization.
export const removalTemplateObservations = pgTable("removal_template_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  provider: certifierProvider("provider").notNull(),
  externalProjectId: text("external_project_id").notNull(),
  externalTemplateId: text("external_template_id").notNull(),
  semanticFingerprint: text("semantic_fingerprint").notNull(),
  fullFingerprint: text("full_fingerprint").notNull(),
  definition: jsonb("definition").$type<TemplateDefinition>().notNull(),
  enrichment: jsonb("enrichment").$type<TemplateEnrichment>().notNull(),
  lineSources: jsonb("line_sources").$type<LineSources>().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
  version: integer("version").notNull().default(1),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow(),
  /** When enrichment was last read from the registry; the reuse TTL runs from here, not from lastObservedAt. */
  enrichedAt: timestamp("enriched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("removal_template_observations_identity_unique").on(
    table.organizationId, table.provider, table.externalTemplateId, table.semanticFingerprint, table.fullFingerprint,
  ),
  unique("removal_template_observations_id_org_unique").on(table.id, table.organizationId),
  index("removal_template_observations_latest_idx").on(
    table.organizationId, table.provider, table.externalTemplateId, table.lastObservedAt,
  ),
]);

export type RemovalTemplateObservation = typeof removalTemplateObservations.$inferSelect;
