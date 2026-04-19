import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  certificationSubmissionStatus,
  certifierProvider,
  syncStatus,
} from './common';
import { facilities } from './facilities';
import { documents } from './documentation';

// Provider-level project registration for a facility.
export const certifierProjects = pgTable(
  'certifier_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    externalProjectId: text('external_project_id').notNull(),
    protocolSlug: text('protocol_slug').notNull().default('biochar'),
    protocolVersion: text('protocol_version'),
    // HMAC secret for verifying incoming Isometric webhook signatures
    webhookSecret: text('webhook_secret'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('certifier_projects_provider_external_unique').on(
      table.provider,
      table.externalProjectId
    ),
    unique('certifier_projects_facility_provider_unique').on(
      table.facilityId,
      table.provider
    ),
  ]
);

export const certifierSources = pgTable(
  'certifier_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: certifierProvider('provider').notNull().default('isometric'),
    sourceType: text('source_type').notNull(),
    sourceReferenceId: text('source_reference_id').notNull(),
    description: text('description'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('certifier_sources_provider_type_ref_unique').on(
      table.provider,
      table.sourceType,
      table.sourceReferenceId
    ),
  ]
);

// Generic, provider-agnostic submission history with immutable payload snapshots.
export const certificationSubmissions = pgTable(
  'certification_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: certifierProvider('provider').notNull().default('isometric'),
    submissionType: text('submission_type').notNull(),
    localEntityType: text('local_entity_type').notNull(),
    localEntityId: uuid('local_entity_id').notNull(),
    sourceId: uuid('source_id').references(() => certifierSources.id),
    externalId: text('external_id'),
    version: integer('version').notNull().default(1),
    status: certificationSubmissionStatus('status').notNull().default('draft'),
    payloadSnapshot: jsonb('payload_snapshot'),
    payloadHash: text('payload_hash'),
    submittedAt: timestamp('submitted_at'),
    lockedAt: timestamp('locked_at'),
    supersededAt: timestamp('superseded_at'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('cert_submissions_entity_version_unique').on(
      table.provider,
      table.submissionType,
      table.localEntityType,
      table.localEntityId,
      table.version
    ),
    unique('cert_submissions_external_unique').on(
      table.provider,
      table.submissionType,
      table.externalId
    ),
  ]
);

export const certifierDocumentUploads = pgTable(
  'certifier_document_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    externalDocumentId: text('external_document_id').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('cert_doc_uploads_provider_document_unique').on(
      table.provider,
      table.documentId
    ),
    unique('cert_doc_uploads_provider_external_unique').on(
      table.provider,
      table.externalDocumentId
    ),
  ]
);

export const certifierSyncEvents = pgTable('certifier_sync_events', {
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
