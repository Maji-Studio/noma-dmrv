import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { CreateBiocharApplicationRequest } from "@/lib/isometric/biochar-applications";
import { applications } from "./application";
import { organizations } from "./auth";
import { certificationSubmissions } from "./certification";
import {
  certifierBiocharApplicationCorrectionStatus,
  certifierBiocharApplicationLifecycleStatus,
  certifierProvider,
} from "./common";
import { certifierProductionBatches } from "./certifier-production-batches";
import { certifierStorageLocations } from "./certifier-storage-locations";
import { creditBatches } from "./credits";

/**
 * Idempotency journal for Isometric Biochar Applications.
 * One row binds an Application and credit/Production Batch slice to one
 * immutable Removal submission version.
 */
export const certifierBiocharApplications = pgTable(
  "certifier_biochar_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    provider: certifierProvider("provider").notNull().default("isometric"),
    applicationId: uuid("application_id").notNull(),
    creditBatchId: uuid("credit_batch_id").notNull(),
    removalSubmissionId: uuid("removal_submission_id")
      .notNull()
      .references(() => certificationSubmissions.id),
    productionBatchRegistrationId: uuid(
      "production_batch_registration_id",
    ).notNull(),
    storageLocationRegistrationId: uuid(
      "storage_location_registration_id",
    ).notNull(),
    externalProductionBatchId: text("external_production_batch_id").notNull(),
    externalStorageLocationId: text("external_storage_location_id").notNull(),
    externalApplicationId: text("external_application_id"),
    supplierReference: text("supplier_reference").notNull(),
    submittedPayload: jsonb("submitted_payload")
      .$type<CreateBiocharApplicationRequest>()
      .notNull(),
    payloadHash: text("payload_hash").notNull(),
    observedGhgEntryId: text("observed_ghg_entry_id"),
    observedRemovalId: text("observed_removal_id"),
    lifecycleStatus: certifierBiocharApplicationLifecycleStatus(
      "lifecycle_status",
    )
      .notNull()
      .default("creating"),
    correctionStatus: certifierBiocharApplicationCorrectionStatus(
      "correction_status",
    )
      .notNull()
      .default("none"),
    driftReason: text("drift_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("certifier_biochar_applications_organization_id_idx").on(
      table.organizationId,
    ),
    index("certifier_biochar_applications_removal_submission_id_idx").on(
      table.removalSubmissionId,
    ),
    unique("certifier_biochar_applications_id_organization_id_unique").on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      columns: [table.applicationId, table.organizationId],
      foreignColumns: [applications.id, applications.organizationId],
    }),
    foreignKey({
      columns: [table.creditBatchId, table.organizationId],
      foreignColumns: [creditBatches.id, creditBatches.organizationId],
    }),
    foreignKey({
      columns: [table.productionBatchRegistrationId, table.organizationId],
      foreignColumns: [
        certifierProductionBatches.id,
        certifierProductionBatches.organizationId,
      ],
    }),
    foreignKey({
      columns: [table.storageLocationRegistrationId, table.organizationId],
      foreignColumns: [
        certifierStorageLocations.id,
        certifierStorageLocations.organizationId,
      ],
    }),
    unique(
      "certifier_biochar_applications_provider_application_batch_submission_unique",
    ).on(
      table.provider,
      table.applicationId,
      table.creditBatchId,
      table.removalSubmissionId,
    ),
    unique("certifier_biochar_applications_provider_reference_unique").on(
      table.provider,
      table.supplierReference,
    ),
    unique("certifier_biochar_applications_provider_external_id_unique").on(
      table.provider,
      table.externalApplicationId,
    ),
    check(
      "certifier_biochar_applications_provider_is_isometric",
      sql`${table.provider} = 'isometric'`,
    ),
    check(
      "certifier_biochar_applications_confirmed_identity",
      sql`${table.lifecycleStatus} <> 'confirmed' or ${table.externalApplicationId} is not null`,
    ),
  ],
);

export type CertifierBiocharApplication =
  typeof certifierBiocharApplications.$inferSelect;
export type NewCertifierBiocharApplication =
  typeof certifierBiocharApplications.$inferInsert;
