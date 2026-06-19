import {
  check,
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
import { sql } from 'drizzle-orm';
import {
  certificationSubmissionStatus,
  certifierProvider,
  projectEmissionCategory,
  syncStatus,
} from './common';
import { facilities, reactors } from './facilities';
import { documents } from './documentation';
import { users } from './auth';

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
    // ADR 0014 removed the three `stage_split_*_pct` columns: energy now
    // submits as one combined measurement point, so there is no per-stage
    // breakdown to apportion. The genset yield above is retained because it is
    // emissions-affecting (litres → kWh).
    // Region-wide conservative fallback used when an application's customer
    // location has no site-specific default soil temperature.
    defaultSoilTemperatureC: real('default_soil_temperature_c'),
    // HMAC secret for verifying incoming Isometric webhook signatures
    webhookSecret: text('webhook_secret'),
    // Phase 5 Slice A — operator-pasted Isometric facility ID
    // (e.g. `fcl_…`). Isometric exposes no `POST /facilities`, so the
    // operator creates the facility in the Certify UI and pastes the ID
    // here. Required before telemetry submission can run; null disables
    // the "Submit Telemetry" button. See ADR 0006 + integration-plan
    // Phase 5 row.
    externalFacilityId: text('external_facility_id'),
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
    // A project may be shared across facilities (above), but the Isometric
    // facility id (fcl_…) is the real 1:1 anchor: two noma facilities pointing
    // at the same Isometric facility would cross-contaminate telemetry. NULL
    // externalFacilityId is allowed for many facilities (Postgres treats NULL
    // tuples as distinct) — only non-null ids must be unique per provider.
    unique('certifier_projects_provider_external_facility_unique').on(
      table.provider,
      table.externalFacilityId
    ),
    check(
      'certifier_projects_default_soil_temperature_c_range',
      sql`${table.defaultSoilTemperatureC} is null or (${table.defaultSoilTemperatureC} >= -50 and ${table.defaultSoilTemperatureC} <= 60)`
    ),
  ]
);

// Phase 5 Slice A — maps a noma reactor + measurement property to the
// Isometric Sensor that receives its telemetry. One row per
// `(provider, reactor, measurement_property)` — a single reactor publishes
// one sensor per quantity (temperature, pressure, …) for each certifier.
// `externalSensorId` is
// the `sns_…` returned by `POST /sensors`; `sensorReference` is the
// stable, noma-controlled reference used by `GET /sensors?reference=…`
// reconciliation when the persistence write lost a race against a sandbox
// reset. `measurementProperty` is a deterministic encoding of the
// Isometric `MeasurementProperty` object: `<quantity_kind>` when
// `qualifier` is null, otherwise `<quantity_kind>|<qualifier>`. Encoding
// it as a single text column lets the unique constraint cover the
// "qualifier null" case (Postgres unique permits multiple NULLs in a
// nullable column, so a (kind, qualifier) shape would silently allow
// duplicates for the common temperature/pressure pair).
export const certifierSensors = pgTable(
  'certifier_sensors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: certifierProvider('provider').notNull().default('isometric'),
    reactorId: uuid('reactor_id')
      .notNull()
      .references(() => reactors.id),
    measurementProperty: text('measurement_property').notNull(),
    externalSensorId: text('external_sensor_id').notNull(),
    sensorReference: text('sensor_reference').notNull(),
    units: text('units').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('certifier_sensors_provider_reactor_property_unique').on(
      table.provider,
      table.reactorId,
      table.measurementProperty
    ),
    unique('certifier_sensors_provider_reference_unique').on(
      table.provider,
      table.sensorReference
    ),
  ]
);

// Per-facility, per-LCA-window, per-category LCA-derived emission magnitudes
// (ADR 0005). Each row corresponds to one expected `PROJECT`-scope Component
// in the facility's Isometric project; noma does NOT POST these — the
// operator publishes Project Components directly in the Isometric UI, and
// the read-only drift panel on /certification/ reconciles by comparing each
// row to `GET /components?project_id=…&scope=PROJECT` via
// `matchEmissionToComponent` in
// src/lib/isometric/utils/project-emission-match.ts.
//
// The `allocationStrategyRecommendation` is informational copy the admin
// pastes into the Isometric UI when authoring the Project Component
// (default `CUSTOM_TIME_PERIOD` with target_date = lcaWindowEndOn — see
// ADR 0005 §2). Per-category overrides are an admin edit on each row.
export const certifierProjectEmissions = pgTable(
  'certifier_project_emissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    category: projectEmissionCategory('category').notNull(),
    // Inclusive LCA-measurement window. `lcaWindowEndOn` becomes the
    // recommended Certify `target_date` for CUSTOM_TIME_PERIOD allocation.
    lcaWindowStartOn: date('lca_window_start_on').notNull(),
    lcaWindowEndOn: date('lca_window_end_on').notNull(),
    // Transcribed LCA magnitude. Unit string must match the Certify
    // blueprint's `compatible_unit` for this category (see
    // CATEGORY_TO_BLUEPRINT). The drift panel matches with ±0.5% tolerance
    // on this magnitude.
    magnitude: real('magnitude').notNull(),
    unit: text('unit').notNull(),
    allocationStrategyRecommendation: text('allocation_strategy_recommendation')
      .notNull()
      .default('CUSTOM_TIME_PERIOD'),
    // FK to the LCA PDF (or other evidence) in the documents table. Nullable
    // because a row may be entered before its source document upload
    // completes; the admin form prompts for the upload but does not block
    // save. ON DELETE SET NULL so deleting the document does not block the
    // delete and does not leave a dangling FK — the transcription row
    // outlives the source document, which matches the audit posture (the
    // magnitudes are still valid even if the supporting PDF is removed).
    sourceDocumentId: uuid('source_document_id').references(
      () => documents.id,
      { onDelete: 'set null' }
    ),
    notes: text('notes'),
    // Audit trail — who transcribed the LCA value and when.
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => users.id),
    recordedAt: timestamp('recorded_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // One row per (provider, facility, LCA-window-end, category). Two rows
    // for the same period+category would represent transcription drift —
    // edit the existing row rather than minting a duplicate. Provider is
    // included for parity with every other certifier uniqueness constraint.
    unique('certifier_project_emissions_facility_period_category_unique').on(
      table.provider,
      table.facilityId,
      table.lcaWindowEndOn,
      table.category
    ),
    // Indexes the facility FK — drives the admin list view and the drift
    // panel per-facility filter. Postgres does not auto-index FKs.
    index('certifier_project_emissions_facility_id_idx').on(table.facilityId),
    // Window chronology guard — start must precede or equal end.
    check(
      'certifier_project_emissions_window_chronology',
      sql`${table.lcaWindowStartOn} <= ${table.lcaWindowEndOn}`
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
    // Indexes the facility FK — drives listOpenRemovalsForFacility and the
    // Removals hub's per-facility filter. Postgres does not auto-index FKs.
    index('certifier_removals_facility_id_idx').on(table.facilityId),
    // Reporting-window chronology guard. Either bound may still be null
    // (windows are filled in lazily at first submission), but if both are
    // present, start must precede end.
    check(
      'certifier_removals_reporting_window_chronology',
      sql`${table.startedOn} is null or ${table.completedOn} is null or ${table.startedOn} <= ${table.completedOn}`
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
