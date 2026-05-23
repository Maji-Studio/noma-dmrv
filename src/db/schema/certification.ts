import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
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
    // Default Certify removal template used when submitting credit batches for this facility.
    defaultRemovalTemplateId: text('default_removal_template_id'),
    // --- Phase 3.7 emission-estimate config (per facility) ---
    // Diesel-genset electrical yield: kWh produced per litre of genset
    // diesel. Converts noma's litre measurement to the kWh the Certify
    // `energy_based_ci_emissions` components expect. Seed 3.375 (LCA
    // diesel CI 2.7 kgCO2e/L ÷ genset CI 0.8 kgCO2e/kWh).
    gensetEnergyYieldKwhPerLitre: real('genset_energy_yield_kwh_per_litre'),
    // Estimated split of combined per-run energy across the three process
    // stages. Emissions-neutral (all stages share one CI) — affects only
    // the per-stage breakdown shown in the registry. The three must sum
    // to 100.
    stageSplitBiomassPct: real('stage_split_biomass_pct'),
    stageSplitPyrolysisPct: real('stage_split_pyrolysis_pct'),
    stageSplitBiocharPct: real('stage_split_biochar_pct'),
    // HMAC secret for verifying incoming Isometric webhook signatures
    webhookSecret: text('webhook_secret'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // One facility submits to at most one project per provider. The previous
    // (provider, externalProjectId) unique constraint was dropped: real
    // operators commonly register multiple physical sites under one registry
    // project, since Isometric's data model has no facility concept.
    unique('certifier_projects_facility_provider_unique').on(
      table.facilityId,
      table.provider
    ),
  ]
);

// One Isometric GHG Statement — an independent, period-anchored artifact
// that rolls up multiple Removals for a supplier-chosen reporting period
// (ADR 0003 / Phase 4.5). Facility-scoped. The remote statement id, status
// and payload live on the certification_submissions ledger row keyed
// (provider, 'ghg_statement', 'ghgStatement', certifierGhgStatements.id).
export const certifierGhgStatements = pgTable(
  'certifier_ghg_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    // Operator-chosen reporting-period end — the only date Isometric's create
    // API accepts. YYYY-MM-DD.
    reportingPeriodEndOn: date('reporting_period_end_on').notNull(),
    // Server-derived reporting-period start, reconciled back from Isometric
    // after the statement is created. Null until then.
    reportingPeriodStartOn: date('reporting_period_start_on'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // One GHG statement per facility + reporting-period end. The local
    // statement id anchors the submission-claim machinery, so a stable id
    // per (provider, facility, period) lets a double-click / two-tab race
    // resolve to the in-flight or already-created statement instead of
    // minting a second Isometric registry artifact (ADR 0004). Provider is
    // included for parity with every other certifier uniqueness constraint.
    unique('certifier_ghg_statements_facility_period_unique').on(
      table.provider,
      table.facilityId,
      table.reportingPeriodEndOn
    ),
  ]
);

// One Isometric Removal — the submission unit. N credit batches map into a
// single removal (default 1:1 per month; multiple supported). Facility-scoped:
// every member credit batch shares one Isometric project. The remote Removal
// id, status and payload live on the certification_submissions ledger row
// keyed (provider, 'removal', 'removal', certifierRemovals.id).
export const certifierRemovals = pgTable(
  'certifier_removals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    // Reporting window, derived from the aggregated member production runs at
    // submit time. Null until the first submission writes them.
    startedOn: date('started_on'),
    completedOn: date('completed_on'),
    // The GHG Statement this removal was reconciled into, set from the
    // statement's server-side `removal_ids` after create/refresh — never
    // user-assigned. Null until a statement absorbs this removal.
    ghgStatementId: uuid('ghg_statement_id').references(
      () => certifierGhgStatements.id
    ),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Indexes the FK for getRemovalsByGhgStatementId / listOpenRemovalsForFacility
    // lookups and keeps FK-constraint checks fast — Postgres does not
    // auto-index foreign keys.
    index('certifier_removals_ghg_statement_id_idx').on(table.ghgStatementId),
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
