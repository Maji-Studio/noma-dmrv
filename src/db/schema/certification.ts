import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  certificationSubmissionStatus,
  certifierProvider,
  registrySourceVisibility,
  syncStatus,
} from './common';
import { facilities, reactors } from './facilities';
import { documents } from './documentation';
import { organizations, users } from './auth';

export const certifierCredentials = pgTable(
  'certifier_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    provider: certifierProvider('provider').notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    clientSecretEncrypted: text('client_secret_encrypted').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('certifier_credentials_organization_id_provider_unique').on(
      table.organizationId,
      table.provider
    ),
  ]
);

// Organization-wide provider policy for registry artifacts. This deliberately
// sits above facility mappings: one organization policy governs every Source
// created for the provider, regardless of which facility's Settings route the
// operator entered through.
export const certifierOrganizationSettings = pgTable(
  'certifier_organization_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    sourceVisibility: registrySourceVisibility('source_visibility')
      .notNull()
      .default('private'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('certifier_org_settings_organization_provider_unique').on(
      table.organizationId,
      table.provider
    ),
  ]
);

// Provider-level project registration for a facility.
export const certifierProjects = pgTable(
  'certifier_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    facilityId: uuid('facility_id')
      .notNull(),
    provider: certifierProvider('provider').notNull().default('isometric'),
    externalProjectId: text('external_project_id').notNull(),
    protocolSlug: text('protocol_slug').notNull().default('biochar'),
    protocolVersion: text('protocol_version'),
    // Default Certify removal template used when submitting credit batches for this facility.
    defaultRemovalTemplateId: text('default_removal_template_id'),
    // --- Phase 3.7 emission-estimate config (per facility) ---
    // Diesel-genset electrical yield: kWh produced per litre of genset
    // diesel. VESTIGIAL since issue #319: diesel submits as litres via
    // `fuel_usage_by_volume` (EF bound on the Isometric template), so this
    // yield no longer feeds any submission datapoint. Kept only because
    // dropping the column is a migration (follow-up ticket).
    gensetEnergyYieldKwhPerLitre: real('genset_energy_yield_kwh_per_litre'),
    // ADR 0015 removed the three `stage_split_*_pct` columns: energy now
    // submits as one combined measurement point, so there is no per-stage
    // breakdown to apportion.
    // Operator-declared facility-level REFERENCE soil temperature (°C) — the
    // authoritative annual-average value submitted to the registry as the
    // `biochar_soil` measurement for every 200-year removal (ADR 0013, soil
    // module §5.1.1.3.1). Sourced from an approved global soil-temp dataset
    // (Lembrechts et al. 2022 SoilTemp or equivalent) when there is no on-site
    // baseline; air temperature is prohibited. The 7 °C floor + one-decimal
    // rounding are applied at resolve time (`resolveFacilityReferenceSoilTemperature`).
    // It also remains the last-resort fallback for an application's per-site
    // default when neither the application nor its customer location declares one.
    defaultSoilTemperatureC: real('default_soil_temperature_c'),
    // Dataset / region citation for the reference soil temperature above —
    // free text recorded for the PDD audit trail (e.g. "Lembrechts et al. 2022
    // SoilTemp, 0–5 cm, <region>"). The Isometric `CreateMeasurementSampleRequest`
    // body carries no description field, so the justification lives here + in the
    // PDD, not on the wire.
    defaultSoilTemperatureSource: text('default_soil_temperature_source'),
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
    index('certifier_projects_organization_id_idx').on(table.organizationId),
    unique('certifier_projects_id_organization_id_unique').on(
      table.id,
      table.organizationId
    ),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    // Long-tail parent (plan §1.2): org integrity is app-enforced via
    // assertSameOrg(ctx, reactors, …) in the certifier-sensors data access,
    // not a composite FK (those are reserved for the seven hot-path parents).
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
    index('certifier_sensors_organization_id_idx').on(table.organizationId),
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

// (The `certifier_project_emissions` LCA-journal table lived here under
// ADR 0005 Posture B; removed per ADR 0018 — Isometric is the sole
// system-of-record for PROJECT-scope emission Components.)

// One Isometric GHG Statement — an independent, period-anchored artifact
// that rolls up multiple Removals for a supplier-chosen reporting period
// (ADR 0003 / Phase 4.5). Facility-scoped. The remote statement id, status
// and payload live on the certification_submissions ledger row keyed
// (provider, 'ghg_statement', 'ghgStatement', certifierGhgStatements.id).
export const CERTIFIER_GHG_STATEMENT_REMOTE_EXTERNAL_ID_METADATA_KEY =
  'remoteExternalId';

export const certifierGhgStatements = pgTable(
  'certifier_ghg_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    facilityId: uuid('facility_id')
      .notNull(),
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
    index('certifier_ghg_statements_organization_id_idx').on(table.organizationId),
    unique('certifier_ghg_statements_id_organization_id_unique').on(
      table.id,
      table.organizationId
    ),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
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
    // Registry discovery is keyed by the remote statement id, not its period:
    // Isometric permits duplicate and null periods. This expression index
    // makes concurrent list/manual reconciles converge on one local identity —
    // per (organization, facility), NOT globally (ADR 0023). One Isometric
    // project may be shared by several noma facilities (see
    // `certifier_projects_facility_provider_unique` above), so a registry
    // statement can legitimately need one local mirror row per facility; a
    // global key also made a registry id collide across tenants.
    uniqueIndex('certifier_ghg_statements_remote_external_id_unique')
      .on(
        table.provider,
        table.organizationId,
        table.facilityId,
        sql`(${table.metadata}->>${sql.raw(`'${CERTIFIER_GHG_STATEMENT_REMOTE_EXTERNAL_ID_METADATA_KEY}'`)})`
      )
      .where(
        sql`${table.metadata}->>${sql.raw(`'${CERTIFIER_GHG_STATEMENT_REMOTE_EXTERNAL_ID_METADATA_KEY}'`)} is not null`
      ),
  ]
);

// Immutable, supplier-generated written report supporting one GHG Statement.
// Each deliberate preparation allocates a new version and private document;
// prior rows and bytes are never replaced or retired.
export const certifierGhgStatementReports = pgTable(
  'certifier_ghg_statement_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    ghgStatementId: uuid('ghg_statement_id').notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    version: integer('version').notNull(),
    lifecycle: text('lifecycle').notNull().default('prepared'),
    sourceFingerprint: text('source_fingerprint').notNull(),
    contentChecksumSha256: text('content_checksum_sha256').notNull(),
    frozenInput: jsonb('frozen_input').notNull(),
    reportModel: jsonb('report_model').notNull(),
    reviewedNarratives: jsonb('reviewed_narratives').notNull(),
    preparationIdempotencyKey: uuid('preparation_idempotency_key').notNull(),
    verifierTokenHash: text('verifier_token_hash').notNull(),
    pendingVerifierTokenHash: text('pending_verifier_token_hash'),
    preparedBy: text('prepared_by')
      .notNull()
      .references(() => users.id),
    preparedAt: timestamp('prepared_at').notNull(),
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    submittedBy: text('submitted_by').references(() => users.id),
    submittedAt: timestamp('submitted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('certifier_ghg_statement_reports_organization_id_idx').on(
      table.organizationId
    ),
    foreignKey({
      columns: [table.ghgStatementId, table.organizationId],
      foreignColumns: [
        certifierGhgStatements.id,
        certifierGhgStatements.organizationId,
      ],
    }),
    unique('certifier_ghg_statement_reports_statement_version_unique').on(
      table.ghgStatementId,
      table.version
    ),
    unique('certifier_ghg_statement_reports_statement_preparation_key_unique').on(
      table.ghgStatementId,
      table.preparationIdempotencyKey
    ),
    unique('certifier_ghg_statement_reports_document_id_unique').on(
      table.documentId
    ),
    check(
      'certifier_ghg_statement_reports_version_positive',
      sql`${table.version} > 0`
    ),
    check(
      'certifier_ghg_statement_reports_lifecycle_check',
      sql`${table.lifecycle} in ('prepared', 'approved', 'submitted')`
    ),
    check(
      'certifier_ghg_statement_reports_approval_coheres',
      sql`(${table.approvedBy} is null) = (${table.approvedAt} is null)`
    ),
    check(
      'certifier_ghg_statement_reports_submission_coheres',
      sql`(${table.submittedBy} is null) = (${table.submittedAt} is null)`
    ),
    check(
      'certifier_ghg_statement_reports_lifecycle_timestamps_check',
      sql`(
        (${table.lifecycle} = 'prepared' and ${table.approvedAt} is null and ${table.submittedAt} is null)
        or (${table.lifecycle} = 'approved' and ${table.approvedAt} is not null and ${table.submittedAt} is null)
        or (${table.lifecycle} = 'submitted' and ${table.approvedAt} is not null and ${table.submittedAt} is not null)
      )`
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    facilityId: uuid('facility_id')
      .notNull(),
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
    index('certifier_removals_organization_id_idx').on(table.organizationId),
    unique('certifier_removals_id_organization_id_unique').on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
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

// The ledger `submission_type` a GHG Statement is filed under. Duplicated as a
// literal here — the schema layer is the bottom of the import graph and must
// not pull in `@/lib/isometric/utils/constants` (which client bundles import) —
// and asserted equal to `GHG_STATEMENT_SUBMISSION_TYPE` in
// tests/ghg-statement-facility-identity.test.ts.
export const GHG_STATEMENT_LEDGER_SUBMISSION_TYPE = 'ghg_statement';

// Generic, provider-agnostic submission history with immutable payload snapshots.
export const certificationSubmissions = pgTable(
  'certification_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
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
    index('certification_submissions_organization_id_idx').on(table.organizationId),
    unique('cert_submissions_entity_version_unique').on(
      table.provider,
      table.submissionType,
      table.localEntityType,
      table.localEntityId,
      table.version
    ),
    // Remote-id uniqueness, split by submission type (ADR 0023).
    //
    // Every type except `ghg_statement` keeps the original global rule: one
    // local entity per remote artifact id. A Removal belongs to exactly one
    // facility, so nothing legitimate collides here.
    //
    // A GHG Statement is different. One Isometric project may be shared by
    // several noma facilities, and statement identity is now scoped per
    // (organization, facility) — so the SAME registry statement legitimately
    // gets one local mirror row (and one ledger row) per facility. The
    // narrower index below keeps the invariant that still matters: a single
    // local statement never carries the same remote id on two ledger rows.
    uniqueIndex('cert_submissions_external_unique')
      .on(table.provider, table.submissionType, table.externalId)
      .where(
        sql`${table.submissionType} <> ${sql.raw(`'${GHG_STATEMENT_LEDGER_SUBMISSION_TYPE}'`)}`
      ),
    uniqueIndex('cert_submissions_ghg_statement_external_unique')
      .on(
        table.provider,
        table.organizationId,
        table.localEntityId,
        table.externalId
      )
      .where(
        sql`${table.submissionType} = ${sql.raw(`'${GHG_STATEMENT_LEDGER_SUBMISSION_TYPE}'`)}`
      ),
  ]
);

export const certifierDocumentUploads = pgTable(
  'certifier_document_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
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
    index('certifier_document_uploads_organization_id_idx').on(table.organizationId),
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
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  provider: certifierProvider('provider').notNull().default('isometric'),
  entityType: text('entity_type').notNull(),
  // Polymorphic per entityType: UUIDs for local rows (removals, documents),
  // supplier references (nm-slc-*) for storage locations — hence text.
  entityId: text('entity_id').notNull(),
  operation: text('operation').notNull(),
  status: syncStatus('status').notNull().default('pending'),
  requestPayload: jsonb('request_payload'),
  responsePayload: jsonb('response_payload'),
  errorMessage: text('error_message'),
  attemptedAt: timestamp('attempted_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('certifier_sync_events_organization_id_idx').on(table.organizationId),
]);
