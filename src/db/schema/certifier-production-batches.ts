import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { certifierProvider } from './common';
import { massKg } from './numeric-families';
import { creditBatches } from './credits';
import { organizations } from './auth';

// CERTIFIER-OWNED EXTERNAL IDENTIFIERS — not a noma domain table.
//
// Maps a credit batch (the protocol production batch — ADR 0016) to the
// ISOMETRIC `ProductionBatch` (`ptb_…`) registered for it (issue #630). The
// `certifier_` prefix, the `provider` column and the `external_` column prefix
// all say the same thing: every identifier here is minted by the registry, and
// noma is only mirroring it. Nothing in this table is a source of truth for
// production; the credit batch and its runs are.
//
// Lives in its own schema module because `credits.ts` already imports
// `certification.ts` (for `certifier_removals`); putting this table there would
// close an import cycle. The composite FK to `(id, organization_id)` keeps the
// tenant boundary at the database, matching the other hot-path parents.
//
// The row IS the idempotency journal: it is written on the same confirmation
// that mints the remote record, so a later attempt reuses `ptb_…` instead of
// POSTing a second batch. `POST /production_batches` is not idempotent and
// `GET /production_batches` has no supplier-reference filter, so a lost row is
// recovered by the paginating supplier-ref reconcile in
// `fn/certification/production-batches.ts`, never by a blind re-POST.
//
// `mass_kg`, `started_on` and `ended_on` mirror what was actually registered,
// so the submitted totals and window stay readable in noma dMRV without a
// registry round-trip; `payload_hash` fingerprints the whole submitted body so
// later drift against live data is detectable (the registry exposes no PATCH
// for a production batch).
export const certifierProductionBatches = pgTable(
  'certifier_production_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    provider: certifierProvider('provider').notNull().default('isometric'),
    creditBatchId: uuid('credit_batch_id').notNull(),
    externalProductionBatchId: text('external_production_batch_id').notNull(),
    supplierReference: text('supplier_reference').notNull(),
    // Immutable registration/claim-time snapshot used to address this record.
    externalProjectId: text('external_project_id'),
    // Immutable registration/claim-time snapshot used to address this record.
    externalFacilityId: text('external_facility_id'),
    // Total dry biochar mass registered as `M_biochar (DM)`, in kilograms.
    massKg: massKg('mass_kg').notNull(),
    startedOn: date('started_on').notNull(),
    endedOn: date('ended_on').notNull(),
    payloadHash: text('payload_hash').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('certifier_production_batches_organization_id_idx').on(
      table.organizationId
    ),
    foreignKey({
      columns: [table.creditBatchId, table.organizationId],
      foreignColumns: [creditBatches.id, creditBatches.organizationId],
    }),
    // One registered production batch per credit batch and provider — the
    // constraint that makes the ensure path idempotent under a concurrent
    // double submit.
    unique('certifier_production_batches_provider_credit_batch_unique').on(
      table.provider,
      table.creditBatchId
    ),
    // The supplier reference is unique registry-side; keep it unique locally so
    // two credit batches can never claim the same remote record.
    unique('certifier_production_batches_provider_reference_unique').on(
      table.provider,
      table.supplierReference
    ),
    unique('certifier_production_batches_provider_external_id_unique').on(
      table.provider,
      table.externalProductionBatchId
    ),
    // A Production Batch is an Isometric Certify resource — no other certifier
    // in the `certifier_provider` enum defines one. Pin it the way
    // `credit_batches_certifier_is_isometric` does, so a row can never claim to
    // hold a Puro/Verra artifact in an Isometric-shaped column.
    check(
      'certifier_production_batches_provider_is_isometric',
      sql`${table.provider} = 'isometric'`
    ),
    check(
      'certifier_production_batches_mass_positive',
      sql`${table.massKg} > 0`
    ),
    check(
      'certifier_production_batches_window_chronology',
      sql`${table.startedOn} <= ${table.endedOn}`
    ),
  ]
);
