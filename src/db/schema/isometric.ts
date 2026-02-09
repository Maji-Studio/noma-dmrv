import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';
import { certifierProvider, syncStatus } from './common';
import { facilities } from './facilities';
import { productionRuns } from './production';
import { applications } from './application';
import { creditBatches } from './credits';
import { documents } from './documentation';

// Provider-level project registration for a facility.
export const isometricProjects = pgTable(
  'isometric_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    externalProjectId: text('external_project_id').notNull(),
    protocolSlug: text('protocol_slug').notNull().default('biochar'),
    protocolVersion: text('protocol_version').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('isometric_projects_provider_external_project_unique').on(
      table.provider,
      table.externalProjectId
    ),
    unique('isometric_projects_facility_provider_unique').on(
      table.facilityId,
      table.provider
    ),
  ]
);

export const isometricProductionBatches = pgTable(
  'isometric_production_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productionRunId: uuid('production_run_id')
      .notNull()
      .references(() => productionRuns.id),
    externalProductionBatchId: text('external_production_batch_id').notNull(),
    payloadSnapshot: jsonb('payload_snapshot'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('isometric_production_batches_run_unique').on(table.productionRunId),
    unique('isometric_production_batches_external_unique').on(
      table.externalProductionBatchId
    ),
  ]
);

export const isometricStorageLocations = pgTable(
  'isometric_storage_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),
    externalStorageLocationId: text('external_storage_location_id').notNull(),
    payloadSnapshot: jsonb('payload_snapshot'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('isometric_storage_locations_application_unique').on(
      table.applicationId
    ),
    unique('isometric_storage_locations_external_unique').on(
      table.externalStorageLocationId
    ),
  ]
);

export const isometricBiocharApplications = pgTable(
  'isometric_biochar_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),
    externalBiocharApplicationId: text('external_biochar_application_id').notNull(),
    payloadSnapshot: jsonb('payload_snapshot'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('isometric_biochar_applications_application_unique').on(
      table.applicationId
    ),
    unique('isometric_biochar_applications_external_unique').on(
      table.externalBiocharApplicationId
    ),
  ]
);

export const isometricRemovals = pgTable(
  'isometric_removals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditBatchId: uuid('credit_batch_id')
      .notNull()
      .references(() => creditBatches.id),
    externalRemovalId: text('external_removal_id').notNull(),
    payloadSnapshot: jsonb('payload_snapshot'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('isometric_removals_credit_batch_unique').on(table.creditBatchId),
    unique('isometric_removals_external_unique').on(table.externalRemovalId),
  ]
);

export const isometricGhgStatements = pgTable(
  'isometric_ghg_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditBatchId: uuid('credit_batch_id')
      .notNull()
      .references(() => creditBatches.id),
    externalGhgStatementId: text('external_ghg_statement_id').notNull(),
    payloadSnapshot: jsonb('payload_snapshot'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('isometric_ghg_statements_credit_batch_unique').on(table.creditBatchId),
    unique('isometric_ghg_statements_external_unique').on(
      table.externalGhgStatementId
    ),
  ]
);

export const isometricDocumentUploads = pgTable(
  'isometric_document_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    externalDocumentId: text('external_document_id').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('isometric_document_uploads_document_unique').on(table.documentId),
    unique('isometric_document_uploads_external_unique').on(
      table.externalDocumentId
    ),
  ]
);

export const isometricSyncEvents = pgTable('isometric_sync_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: certifierProvider('provider').notNull().default('isometric'),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  operation: text('operation').notNull(),
  status: syncStatus('status').notNull().default('pending'),
  requestPayload: jsonb('request_payload'),
  responsePayload: jsonb('response_payload'),
  errorMessage: text('error_message'),
  attemptedAt: timestamp('attempted_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
