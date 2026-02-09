import {
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  date,
  integer,
  boolean,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { creditBatchStatus, durabilityOption } from './common';
import { facilities, reactors } from './facilities';
import { applications } from './application';
import { samples } from './production';

// ============================================
// Credit Batches - Carbon credit batches for registry
// Isometric Protocol: Verification requirements
// ============================================

export const creditBatches = pgTable('credit_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // e.g., "CB-2025-043"
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id),
  // Production runs are traced via FK chain: CreditBatch → Application → Delivery → BiocharProduct → ProductionRun
  date: date('date').notNull(),
  status: creditBatchStatus('status').default('pending').notNull(),

  // --- Overview ---
  reactorId: uuid('reactor_id').references(() => reactors.id),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
  reportingPeriodStart: date('reporting_period_start')
    .notNull()
    .default(sql`CURRENT_DATE`),
  reportingPeriodEnd: date('reporting_period_end')
    .notNull()
    .default(sql`CURRENT_DATE`),
  certifier: text('certifier'), // e.g., "Isometric"
  registry: text('registry'), // e.g., "Isometric"

  // --- Credit Details (Isometric Protocol Section 8) ---
  batchesCount: integer('batches_count'),
  weightTons: real('weight_tons'),
  creditsTco2e: real('credits_tco2e'), // Net CO2e removal
  valueTzs: real('value_tzs'),

  // Isometric: Buffer pool contribution (risk-based 2-20%)
  bufferPoolPercent: real('buffer_pool_percent'),

  // --- Durability Calculation (Isometric: Soil Storage Module Section 5.1) ---
  // Project-level choice: 200-year (H:Corg + soil temp) or 1000-year (R0 reflectance)
  durabilityOptionType: durabilityOption('durability_option')
    .notNull()
    .default('200_year'),

  // --- 200-Year Durability Fields ---
  // Soil temperature - required for F_durable calculation (200-year option)
  // Formula: F_durable,200 = min(0.95, 1 - [c + (a + b·ln(T_soil))·H/C_org])
  // Where: a=-0.383, b=0.350, c=-0.048
  soilTemperatureC: real('soil_temperature_c'), // Annual average for project area
  soilTemperatureCelsius: real('soil_temperature_celsius'),
  soilTemperatureSource: text('soil_temperature_source'), // 'baseline' | 'global_database'
  hToCorgRatio: real('h_to_c_org_ratio'), // H:Corg ratio (calculated from samples)

  // --- 1000-Year Durability Fields ---
  // Based on petrographic analysis (R₀) and TGA (non-reactive carbon)
  // Formula: F_durable,1000 = min(0.95, max(0, (R̄₀ - s_R₀) × (C̄_non-reactive - s_C_non-reactive)))
  meanRandomReflectancePercent: real('mean_random_reflectance_percent'), // Mean R₀ from samples
  stdRandomReflectance: real('std_random_reflectance'), // Standard deviation of R₀
  meanNonReactiveCarbonPercent: real('mean_non_reactive_carbon_percent'), // Mean from TGA
  stdNonReactiveCarbonPercent: real('std_non_reactive_carbon_percent'), // Std dev from TGA
  stdNonReactiveCarbon: real('std_non_reactive_carbon'),

  // --- Calculated Durability Fraction ---
  // Applies to all applications in this batch (max 0.95)
  fDurableCalculated: real('f_durable_calculated'),
  fDurableFraction: real('f_durable_fraction'),

  // --- Net CO2e Removal Calculation (Isometric GHG Accounting Module v1.0) ---
  // Net CO₂e Removal = CO₂e Stored - CO₂e Emissions - CO₂e Counterfactual
  totalCo2eStoredTons: real('total_co2e_stored_tons'), // Carbon durably stored
  totalCo2eEmissionsTons: real('total_co2e_emissions_tons'), // Project emissions
  totalCo2eCounterfactualTons: real('total_co2e_counterfactual_tons'), // Baseline emissions
  netCo2eRemovalTons: real('net_co2e_removal_tons'), // Final net removal
  totalCreditsTons: real('total_credits_tons'),

  // --- Site Management Summary (Isometric: Section 5.2.1) ---
  // Aggregated info for GHG Statement submission
  siteManagementNotes: text('site_management_notes'), // Irrigation, tillage, fertilizer summary

  // --- Third-Party Sale Verification (Isometric: SubRequirement G-SZZR-0) ---
  // Required when biochar is sold to third parties before application
  affidavitReference: text('affidavit_reference'), // Legally binding declaration ref
  intendedUseConfirmation: text('intended_use_confirmation'), // Explicit soil application intent
  companyVerificationRef: text('company_verification_ref'), // 3+ years active ag company proof
  mixingTimelineDays: integer('mixing_timeline_days'), // Days until mixed with soil

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Lab Analyses - External laboratory reports
// Isometric Protocol: Section 8.3 (Sampling requirements)
// ============================================

export const labAnalyses = pgTable('lab_analyses', {
  id: uuid('id').primaryKey().defaultRandom(),
  creditBatchId: uuid('credit_batch_id')
    .notNull()
    .references(() => creditBatches.id),
  sampleId: uuid('sample_id')
    .notNull()
    .references(() => samples.id),
  labName: text('lab_name').notNull(),
  analysisDate: timestamp('analysis_date').notNull(),
  iso17025Accreditation: boolean('iso_17025_accreditation').notNull(),
  results: jsonb('results').notNull(),
  analystName: text('analyst_name'),
  reportFileUrl: text('report_file_url').notNull(),
  reportFile: text('report_file').notNull(), // URL/path to report file
  notes: text('notes'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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

export const creditBatchesRelations = relations(
  creditBatches,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [creditBatches.facilityId],
      references: [facilities.id],
    }),
    reactor: one(reactors, {
      fields: [creditBatches.reactorId],
      references: [reactors.id],
    }),
    labAnalyses: many(labAnalyses),
    creditBatchApplications: many(creditBatchApplications),
  })
);

export const labAnalysesRelations = relations(labAnalyses, ({ one }) => ({
  creditBatch: one(creditBatches, {
    fields: [labAnalyses.creditBatchId],
    references: [creditBatches.id],
  }),
  sample: one(samples, {
    fields: [labAnalyses.sampleId],
    references: [samples.id],
  }),
}));

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
