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
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import {
  climateVolatilityRisk,
  creditBatchStatus,
  durabilityOption,
  landTenureType,
  naturalDisasterRisk,
  operatorTrackRecord,
  soilErosionRisk,
} from './common';
import { facilities } from './facilities';
import { applications } from './application';
import { certifierRemovals } from './certification';

// ============================================
// Reversal Risk Assessments - Justification for buffer pool %
// Isometric Protocol: Appendix I — Reversal Risk Assessment
// Connected to facility (risk is per project area). Credit batches reference the applicable assessment.
// ============================================

export const reversalRiskAssessments = pgTable(
  'reversal_risk_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "RRA-2025-001"
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    landTenureType: landTenureType('land_tenure_type').notNull(),
    soilErosionRisk: soilErosionRisk('soil_erosion_risk').notNull(),
    climateVolatilityRisk: climateVolatilityRisk('climate_volatility_risk').notNull(),
    naturalDisasterRisk: naturalDisasterRisk('natural_disaster_risk').notNull(),
    operatorTrackRecord: operatorTrackRecord('operator_track_record').notNull(),
    calculatedBufferPercent: real('calculated_buffer_percent').notNull(),
    locationNotes: text('location_notes'), // regional context (geography, land use, etc.)
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'reversal_risk_buffer_percent_range',
      sql`${table.calculatedBufferPercent} >= 0 and ${table.calculatedBufferPercent} <= 20`
    ),
  ]
);

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
    status: creditBatchStatus('status').default('pending').notNull(),

    // --- Overview ---
    // Reactor traceable via FK chain: CreditBatch → Application → Delivery → BiocharProduct → ProductionRun → Reactor
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    certifier: text('certifier'),
    registry: text('registry'), // e.g., "Isometric"

    // --- Credit Details (Isometric Protocol Section 8) ---
    weightTons: real('weight_tons'),
    value: real('value'),
    currency: text('currency').notNull().default('TZS'), // ISO 4217 code

    // Isometric: Buffer pool contribution (risk-based 2-20%)
    bufferPoolPercent: real('buffer_pool_percent'),

    // --- Durability Calculation (Isometric: Soil Storage Module Section 5.1) ---
    // Project-level choice: 200-year (H:Corg + soil temp) or 1000-year (R0 reflectance)
    durabilityOption: durabilityOption('durability_option')
      .notNull()
      .default('200_year'),

    // --- 200-Year Durability Fields ---
    // Soil temperature inputs (soil_temperature_c, soil_temperature_source) live on applications
    // Formula: F_durable,200 = min(0.95, 1 - [c + (a + b·ln(T_soil))·H/C_org])
    // Where: a=-0.383, b=0.350, c=-0.048
    hToCorgRatio: real('h_to_c_org_ratio'), // H:Corg ratio (calculated from samples)

    // --- 1000-Year Durability Fields ---
    // Based on petrographic analysis (R₀) and TGA (non-reactive carbon)
    // Formula: F_durable,1000 = min(0.95, max(0, (R̄₀ - s_R₀) × (C̄_non-reactive - s_C_non-reactive)))
    meanRandomReflectancePercent: real('mean_random_reflectance_percent'), // Mean R₀ from samples
    stdRandomReflectance: real('std_random_reflectance'), // Standard deviation of R₀
    meanNonReactiveCarbonPercent: real('mean_non_reactive_carbon_percent'), // Mean from TGA
    stdNonReactiveCarbonPercent: real('std_non_reactive_carbon_percent'), // Std dev from TGA

    // --- Calculated Durability Fraction ---
    // Applies to all applications in this batch (max 0.95)
    fDurableCalculated: real('f_durable_calculated'),

    // --- Net CO2e Removal Calculation (Isometric GHG Accounting Module v1.0) ---
    // Net CO₂e Removal = CO₂e Stored - CO₂e Emissions - CO₂e Counterfactual
    totalCo2eStoredTons: real('total_co2e_stored_tons'), // Carbon durably stored
    totalCo2eEmissionsTons: real('total_co2e_emissions_tons'), // Project emissions
    totalCo2eCounterfactualTons: real('total_co2e_counterfactual_tons'), // Baseline emissions
    // netCo2eRemovalTons: derivable from stored - emissions - counterfactual

    // --- Feedstock Eligibility Summary (Isometric: >25% ineligible-biomass cap, P0-01) ---
    // Computed by app logic when building/updating a batch from linked feedstock batches
    totalFeedstockMassKg: real('total_feedstock_mass_kg'),
    ineligibleFeedstockMassKg: real('ineligible_feedstock_mass_kg'),

    // --- Site Management Summary (Isometric: Section 5.2.1) ---
    // Aggregated info for GHG Statement submission
    siteManagementNotes: text('site_management_notes'), // Irrigation, tillage, fertilizer summary

    // --- Gas Composition (batch-level, moved from production_run_readings) ---
    ch4CompositionPercent: real('ch4_composition_percent'),
    ch4Ppm: real('ch4_ppm'),
    coCompositionPercent: real('co_composition_percent'),
    coPpm: real('co_ppm'),
    co2CompositionPercent: real('co2_composition_percent'),
    co2Ppm: real('co2_ppm'),
    n2oCompositionPercent: real('n2o_composition_percent'),
    n2oPpm: real('n2o_ppm'),

    // --- Reversal Risk (Isometric: Appendix I) ---
    // References the risk assessment that justifies the bufferPoolPercent value
    reversalRiskAssessmentId: uuid('reversal_risk_assessment_id').references(
      () => reversalRiskAssessments.id
    ),

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

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'credit_batches_certifier_is_isometric',
      sql`${table.certifier} = 'isometric'`
    ),
    check(
      'credit_batches_total_feedstock_mass_non_negative',
      sql`${table.totalFeedstockMassKg} is null or ${table.totalFeedstockMassKg} >= 0`
    ),
    check(
      'credit_batches_ineligible_feedstock_mass_non_negative',
      sql`${table.ineligibleFeedstockMassKg} is null or ${table.ineligibleFeedstockMassKg} >= 0`
    ),
    check(
      'credit_batches_ineligible_feedstock_check',
      sql`${table.ineligibleFeedstockMassKg} is null
        or ${table.totalFeedstockMassKg} is null
        or ${table.ineligibleFeedstockMassKg} <= ${table.totalFeedstockMassKg}`
    ),
    // Indexes the Removal grouping FK — drives "find credit batches in
    // removal X" lookups during submission. Postgres does not auto-index
    // foreign keys.
    index('credit_batches_removal_id_idx').on(table.removalId),
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
// Relations
// ============================================

export const reversalRiskAssessmentsRelations = relations(
  reversalRiskAssessments,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [reversalRiskAssessments.facilityId],
      references: [facilities.id],
    }),
    creditBatches: many(creditBatches),
  })
);

export const creditBatchesRelations = relations(
  creditBatches,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [creditBatches.facilityId],
      references: [facilities.id],
    }),
    reversalRiskAssessment: one(reversalRiskAssessments, {
      fields: [creditBatches.reversalRiskAssessmentId],
      references: [reversalRiskAssessments.id],
    }),
    removal: one(certifierRemovals, {
      fields: [creditBatches.removalId],
      references: [certifierRemovals.id],
    }),
    creditBatchApplications: many(creditBatchApplications),
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

// ============================================
// Type Exports
// ============================================

export type ReversalRiskAssessment = typeof reversalRiskAssessments.$inferSelect;
export type NewReversalRiskAssessment = typeof reversalRiskAssessments.$inferInsert;
export type CreditBatch = typeof creditBatches.$inferSelect;
export type NewCreditBatch = typeof creditBatches.$inferInsert;
export type CreditBatchApplication = typeof creditBatchApplications.$inferSelect;
export type NewCreditBatchApplication = typeof creditBatchApplications.$inferInsert;
