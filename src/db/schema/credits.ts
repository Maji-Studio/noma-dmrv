import {
  pgTable,
  text,
  timestamp,
  uuid,
  date,
  integer,
  primaryKey,
  check,
  foreignKey,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { creditBatchSampling, creditBatchStatus } from './common';
import { massKg, percent, ppm } from './numeric-families';
import { facilities } from './facilities';
import { feedstockTypes } from './feedstock';
import { productionProcesses } from './production-processes';
import { applications } from './application';
import { productionRuns } from './production';
import { certifierRemovals } from './certification';
import { organizations } from './auth';

// ============================================
// Credit Batches - Carbon credit batches for registry
// Isometric Protocol: Verification requirements
// ============================================

export const creditBatches = pgTable(
  'credit_batches',
  {
    version: integer('version').notNull().default(1),
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(), // e.g., "CB-2025-043"
    facilityId: uuid('facility_id')
      .notNull(),
    // --- Production-batch identity (ADR 0016) ---
    // The credit batch IS the Isometric protocol production batch: ONE
    // feedstock, facility-scoped. noma conservatively caps it at <=1 month
    // (ADR 0016). feedstockTypeId is declared at creation and asserted
    // against every member run.
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),
    // The (facility, feedstock) process epoch this batch is one <=1-month slice
    // of. Auto-found-or-created when the batch is built.
    productionProcessId: uuid('production_process_id')
      .notNull()
      .references(() => productionProcesses.id),
    removalTemplateId: text('removal_template_id'),
    status: creditBatchStatus('status').default('pending').notNull(),
    // Fixed at creation. Unsampled is accepted only after the current process
    // clears its live Method-B eligibility gates (ADR 0022).
    sampling: creditBatchSampling('sampling').default('sampled').notNull(),

    // --- Overview ---
    // Reactor traceable via FK chain: CreditBatch → Application → Delivery → BiocharProduct → ProductionRun → Reactor
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    certifier: text('certifier'),

    // --- Credit Details (Isometric Protocol Section 8) ---
    // Applied weight is derived on read from member applications
    // (Σ biocharAppliedTons) — never stored (issue #285, ADR 0014).

    // Durability tier is inherited from the facility (ADR 0021).
    // Chemistry and durability are derived from sample replicates.

    // --- Net CO2e Removal (Isometric GHG Accounting Module) ---
    // CO₂e stored is derived on read from member applications (co2eStored
    // preview); project emissions / counterfactual are registry-owned
    // (ADR 0018) — no local copies are stored (issue #285).

    // --- Site Management Summary (Isometric: Section 5.2.1) ---
    // Aggregated info for GHG Statement submission
    siteManagementNotes: text('site_management_notes'), // Irrigation, tillage, fertilizer summary

    // --- Gas Composition (batch-level, moved from production_run_readings) ---
    ch4CompositionPercent: percent('ch4_composition_percent'),
    ch4Ppm: ppm('ch4_ppm'),
    coCompositionPercent: percent('co_composition_percent'),
    coPpm: ppm('co_ppm'),
    co2CompositionPercent: percent('co2_composition_percent'),
    co2Ppm: ppm('co2_ppm'),
    n2oCompositionPercent: percent('n2o_composition_percent'),
    n2oPpm: ppm('n2o_ppm'),

    // --- §8.6.2 production-emissions front-loading (issue #349, ADR 0020) ---
    // The removal (GHG entry) that claimed this batch's PRODUCTION-bucket
    // emissions in full. Null until the batch's removal first submits
    // successfully; written transactionally with the ledger 'submitted' flip.
    // Idempotent across resubmit/supersede of the SAME removal. A DIFFERENT
    // removal retains stored and delivery inputs while suppressing this
    // batch's already-claimed production inputs.
    productionEmissionsClaimedByRemovalId: uuid(
      'production_emissions_claimed_by_removal_id'
    ).references(() => certifierRemovals.id),
    // Durable pre-POST reservation. The referenced submission row supplies
    // the lease's locked_at/status/external-mutation state; no FK is declared
    // because certification_submissions is a polymorphic ledger.
    productionEmissionsClaimReservedBySubmissionId: uuid(
      'production_emissions_claim_reserved_by_submission_id'
    ),

    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('credit_batches_organization_id_code_unique').on(
      table.organizationId,
      table.code
    ),
    unique('credit_batches_id_organization_id_unique').on(
      table.id,
      table.organizationId
    ),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    check(
      'credit_batches_certifier_is_isometric',
      sql`${table.certifier} is null or ${table.certifier} = 'isometric'`
    ),
    // noma's conservative one-month cap (ADR 0016), applied when Isometric
    // is the certifier. DB backstop aligned with the shared calendar-month
    // predicate used by Zod + server re-validation.
    check(
      'credit_batches_isometric_max_one_month',
      sql`${table.certifier} is distinct from 'isometric'
        or ${table.endDate} <= (${table.startDate} + interval '1 month')::date`
    ),
    // Indexes the production-emissions claim FK (issue #349, ADR 0020) —
    // same rationale: Postgres does not auto-index foreign keys.
    index('credit_batches_production_claim_removal_id_idx').on(
      table.productionEmissionsClaimedByRemovalId
    ),
    index('credit_batches_production_claim_reservation_id_idx').on(
      table.productionEmissionsClaimReservedBySubmissionId
    ),
    foreignKey({
      name: 'credit_batches_process_identity_fk',
      columns: [
        table.productionProcessId,
        table.facilityId,
        table.feedstockTypeId,
      ],
      foreignColumns: [
        productionProcesses.id,
        productionProcesses.facilityId,
        productionProcesses.feedstockTypeId,
      ],
    }),
  ]
);

// ============================================
// Credit Batch Applications - Junction table (M:M)
// Links credit batches to multiple applications
// ============================================

export const creditBatchApplications = pgTable(
  'credit_batch_applications',
  {
    id: uuid('id').notNull().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    creditBatchId: uuid('credit_batch_id')
      .notNull(),
    applicationId: uuid('application_id')
      .notNull(),
    // Immutable physical allocation for this Application x credit-batch
    // slice. Wet and dry mass are persisted independently because commingled
    // source lots can carry different moisture contents.
    allocatedWetMassKg: massKg('allocated_wet_mass_kg').notNull(),
    allocatedDryMassKg: massKg('allocated_dry_mass_kg').notNull(),
    // A Removal owns frozen slices, not whole credit batches. Null means this
    // applied mass is available for the next Removal.
    removalId: uuid('removal_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.creditBatchId, table.applicationId] }),
    index('credit_batch_applications_organization_id_idx').on(table.organizationId),
    index('credit_batch_applications_removal_id_idx').on(table.removalId),
    check(
      'credit_batch_applications_allocated_mass_non_negative',
      sql`${table.allocatedWetMassKg} >= 0 and ${table.allocatedDryMassKg} >= 0`
    ),
    foreignKey({
      columns: [table.creditBatchId, table.organizationId],
      foreignColumns: [creditBatches.id, creditBatches.organizationId],
    }),
    foreignKey({
      columns: [table.applicationId, table.organizationId],
      foreignColumns: [applications.id, applications.organizationId],
    }),
    foreignKey({
      columns: [table.removalId, table.organizationId],
      foreignColumns: [certifierRemovals.id, certifierRemovals.organizationId],
    }),
  ]
);

// ============================================
// Credit Batch Production Runs - Membership table
// Links credit batches to production-run cohorts.
// Strict: a production run belongs to at most one credit batch.
// ============================================

export const creditBatchProductionRuns = pgTable(
  'credit_batch_production_runs',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    creditBatchId: uuid('credit_batch_id')
      .notNull(),
    productionRunId: uuid('production_run_id')
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.creditBatchId, table.productionRunId] }),
    unique('credit_batch_production_runs_run_unique').on(table.productionRunId),
    index('credit_batch_production_runs_organization_id_idx').on(table.organizationId),
    foreignKey({
      columns: [table.creditBatchId, table.organizationId],
      foreignColumns: [creditBatches.id, creditBatches.organizationId],
    }),
    foreignKey({
      columns: [table.productionRunId, table.organizationId],
      foreignColumns: [productionRuns.id, productionRuns.organizationId],
    }),
  ]
);

// ============================================
// Relations
// ============================================

export const creditBatchesRelations = relations(
  creditBatches,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [creditBatches.facilityId],
      references: [facilities.id],
    }),
    feedstockType: one(feedstockTypes, {
      fields: [creditBatches.feedstockTypeId],
      references: [feedstockTypes.id],
    }),
    productionProcess: one(productionProcesses, {
      fields: [creditBatches.productionProcessId],
      references: [productionProcesses.id],
    }),
    creditBatchApplications: many(creditBatchApplications),
    creditBatchProductionRuns: many(creditBatchProductionRuns),
  })
);

export const creditBatchApplicationsRelations = relations(
  creditBatchApplications,
  ({ one }) => ({
    creditBatch: one(creditBatches, {
      fields: [creditBatchApplications.creditBatchId],
      references: [creditBatches.id],
    }),
    application: one(applications, {
      fields: [creditBatchApplications.applicationId],
      references: [applications.id],
    }),
    removal: one(certifierRemovals, {
      fields: [creditBatchApplications.removalId],
      references: [certifierRemovals.id],
    }),
  })
);

export const creditBatchProductionRunsRelations = relations(
  creditBatchProductionRuns,
  ({ one }) => ({
    creditBatch: one(creditBatches, {
      fields: [creditBatchProductionRuns.creditBatchId],
      references: [creditBatches.id],
    }),
    productionRun: one(productionRuns, {
      fields: [creditBatchProductionRuns.productionRunId],
      references: [productionRuns.id],
    }),
  })
);

// ============================================
// Type Exports
// ============================================

export type CreditBatch = typeof creditBatches.$inferSelect;
export type NewCreditBatch = typeof creditBatches.$inferInsert;
export type CreditBatchApplication = typeof creditBatchApplications.$inferSelect;
export type NewCreditBatchApplication = typeof creditBatchApplications.$inferInsert;
export type CreditBatchProductionRun = typeof creditBatchProductionRuns.$inferSelect;
export type NewCreditBatchProductionRun = typeof creditBatchProductionRuns.$inferInsert;
