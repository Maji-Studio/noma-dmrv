import {
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  date,
  integer,
  primaryKey,
  check,
  foreignKey,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { creditBatchStatus, durabilityOption } from './common';
import { fraction, percent, ppm } from './numeric-families';
import { facilities } from './facilities';
import { feedstockTypes } from './feedstock';
import { productionProcesses } from './production-processes';
import { applications } from './application';
import { productionRuns } from './production';
import { certifierRemovals } from './certification';

// ============================================
// Credit Batches - Carbon credit batches for registry
// Isometric Protocol: Verification requirements
// ============================================

export const creditBatches = pgTable(
  'credit_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "CB-2025-043"
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    // --- Production-batch identity (ADR 0016) ---
    // The credit batch IS the Isometric protocol production batch: ONE
    // feedstock, facility-scoped, <=1 month under Isometric. feedstockTypeId is
    // derived from — and asserted single across — the member runs at create /
    // update time (a run blending >1 feedstock type is rejected loudly).
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),
    // The (facility, feedstock) sampling-regime campaign this batch is one
    // <=1-month slice of. Auto-found-or-created when the batch is built.
    productionProcessId: uuid('production_process_id')
      .notNull()
      .references(() => productionProcesses.id),
    status: creditBatchStatus('status').default('pending').notNull(),

    // --- Overview ---
    // Reactor traceable via FK chain: CreditBatch → Application → Delivery → BiocharProduct → ProductionRun → Reactor
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    certifier: text('certifier'),
    registry: text('registry'), // e.g., "Isometric"

    // --- Credit Details (Isometric Protocol Section 8) ---
    // Applied weight is derived on read from member applications
    // (Σ biocharAppliedTons) — never stored (issue #285, ADR 0014).
    value: real('value'),
    currency: text('currency').notNull().default('TZS'), // ISO 4217 code

    // Isometric: Buffer pool contribution (risk-based 2-20%)
    bufferPoolPercent: percent('buffer_pool_percent'),

    // --- Durability Calculation (Isometric: Soil Storage Module Section 5.1) ---
    // Project-level choice: 200-year (H:Corg + soil temp) or 1000-year (R0 reflectance)
    durabilityOption: durabilityOption('durability_option')
      .notNull()
      .default('200_year'),

    // --- 200-Year Durability Fields ---
    // Soil temperature inputs (soil_temperature_c, soil_temperature_source) live on applications
    // Formula: F_durable,200 = min(0.95, 1 - [c + (a + b·ln(T_soil))·H/C_org])
    // Where: a=-0.383, b=0.350, c=-0.048
    hToCorgRatio: fraction('h_to_c_org_ratio'), // H:Corg ratio (calculated from samples)

    // --- 1000-Year Durability Fields ---
    // Based on petrographic analysis (R₀) and TGA (non-reactive carbon)
    // Formula: F_durable,1000 = min(0.95, max(0, (R̄₀ - s_R₀) × (C̄_non-reactive - s_C_non-reactive)))
    meanRandomReflectancePercent: percent('mean_random_reflectance_percent'), // Mean R₀ from samples
    stdRandomReflectance: percent('std_random_reflectance'), // Standard deviation of R₀
    meanNonReactiveCarbonPercent: percent('mean_non_reactive_carbon_percent'), // Mean from TGA
    stdNonReactiveCarbonPercent: percent('std_non_reactive_carbon_percent'), // Std dev from TGA

    // --- Calculated Durability Fraction ---
    // Applies to all applications in this batch (max 0.95)
    fDurableCalculated: fraction('f_durable_calculated'),

    // --- Net CO2e Removal (Isometric GHG Accounting Module) ---
    // CO₂e stored is derived on read from member applications (co2eStored
    // preview); project emissions / counterfactual are registry-owned
    // (ADR 0018) — no local copies are stored (issue #285).

    // --- Feedstock Eligibility (Isometric: >25% ineligible-biomass cap, P0-01) ---
    // Feedstock masses are derived on read from the run-feedstock lineage
    // (Σ massUsedKg, split by feedstock eligibilityStatus) — never stored.

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

    // --- Isometric Removal grouping ---
    // The Isometric Removal this credit batch is submitted within. N credit
    // batches may share one removalId (default 1:1 per month). Null until the
    // batch is assigned to — or lazily creates — a removal at submission time.
    removalId: uuid('removal_id').references(() => certifierRemovals.id),

    // --- Third-Party Sale Verification (Isometric: SubRequirement G-SZZR-0) ---
    // Required when biochar is sold to third parties before application
    affidavitReference: text('affidavit_reference'), // Legally binding declaration ref
    intendedUseConfirmation: text('intended_use_confirmation'), // Explicit soil application intent
    companyVerificationRef: text('company_verification_ref'), // 3+ years active ag company proof
    mixingTimelineDays: integer('mixing_timeline_days'), // Days until mixed with soil

    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'credit_batches_certifier_is_isometric',
      sql`${table.certifier} is null or ${table.certifier} = 'isometric'`
    ),
    // ADR 0016: a credit batch is the protocol production batch (< 1 month).
    // Isometric-conditional DB backstop aligned with the shared calendar-month
    // predicate used by Zod + server re-validation.
    check(
      'credit_batches_isometric_max_one_month',
      sql`${table.certifier} is distinct from 'isometric'
        or ${table.endDate} <= (${table.startDate} + interval '1 month')::date`
    ),
    // Indexes the Removal grouping FK — drives "find credit batches in
    // removal X" lookups during submission. Postgres does not auto-index
    // foreign keys.
    index('credit_batches_removal_id_idx').on(table.removalId),
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
    creditBatchId: uuid('credit_batch_id')
      .notNull()
      .references(() => creditBatches.id),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.creditBatchId, table.applicationId] })]
);

// ============================================
// Credit Batch Production Runs - Membership table
// Links credit batches to production-run cohorts.
// Strict: a production run belongs to at most one credit batch.
// ============================================

export const creditBatchProductionRuns = pgTable(
  'credit_batch_production_runs',
  {
    creditBatchId: uuid('credit_batch_id')
      .notNull()
      .references(() => creditBatches.id),
    productionRunId: uuid('production_run_id')
      .notNull()
      .references(() => productionRuns.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.creditBatchId, table.productionRunId] }),
    unique('credit_batch_production_runs_run_unique').on(table.productionRunId),
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
    removal: one(certifierRemovals, {
      fields: [creditBatches.removalId],
      references: [certifierRemovals.id],
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
