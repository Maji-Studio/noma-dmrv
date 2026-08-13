import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { CreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { organizations } from "./auth";
import { certifierProjects } from "./certification";
import { certifierProvider } from "./common";
import { customerLocations } from "./parties";

export const certifierStorageLocationDriftStatus = pgEnum(
  "certifier_storage_location_drift_status",
  ["in_sync", "drifted"],
);

/**
 * Immutable registry identity for one reusable agricultural application site.
 * Mutable customer-location facts are compared with submittedPayload; drift is
 * journaled for operator review and never PATCHed automatically.
 */
export const certifierStorageLocations = pgTable(
  "certifier_storage_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    provider: certifierProvider("provider").notNull().default("isometric"),
    customerLocationId: uuid("customer_location_id").notNull(),
    certifierProjectId: uuid("certifier_project_id").notNull(),
    externalProjectId: text("external_project_id").notNull(),
    externalStorageLocationId: text("external_storage_location_id").notNull(),
    supplierReference: text("supplier_reference").notNull(),
    submittedPayload: jsonb("submitted_payload")
      .$type<CreateStorageLocationRequest>()
      .notNull(),
    payloadHash: text("payload_hash").notNull(),
    driftStatus: certifierStorageLocationDriftStatus("drift_status")
      .notNull()
      .default("in_sync"),
    driftDetails: jsonb("drift_details").$type<Record<string, unknown>>(),
    driftDetectedAt: timestamp("drift_detected_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("certifier_storage_locations_organization_id_idx").on(
      table.organizationId,
    ),
    unique("certifier_storage_locations_id_organization_id_unique").on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      columns: [table.customerLocationId, table.organizationId],
      foreignColumns: [customerLocations.id, customerLocations.organizationId],
    }),
    foreignKey({
      columns: [table.certifierProjectId, table.organizationId],
      foreignColumns: [certifierProjects.id, certifierProjects.organizationId],
    }),
    unique("certifier_storage_locations_provider_customer_location_unique").on(
      table.provider,
      table.customerLocationId,
    ),
    unique("certifier_storage_locations_provider_reference_unique").on(
      table.provider,
      table.supplierReference,
    ),
    unique("certifier_storage_locations_provider_external_id_unique").on(
      table.provider,
      table.externalStorageLocationId,
    ),
    check(
      "certifier_storage_locations_provider_is_isometric",
      sql`${table.provider} = 'isometric'`,
    ),
  ],
);

export type CertifierStorageLocation =
  typeof certifierStorageLocations.$inferSelect;
export type NewCertifierStorageLocation =
  typeof certifierStorageLocations.$inferInsert;
