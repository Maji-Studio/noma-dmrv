import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  date,
  integer,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql, type InferSelectModel } from 'drizzle-orm';
import { electricitySourceCategory, incidentSeverity, productionRunStatus } from './common';
import { fraction, massKg, percent, ppm } from './numeric-families';
import { facilities, reactors, storageLocations } from './facilities';
import { operators } from './parties';
import { feedstocks } from './feedstock';
import { organizations } from './auth';

// ============================================
// Production Runs - Pyrolysis batches
// Isometric Protocol: Section 9 (Pyrolysis Reactor System Requirements)
// ============================================

export const productionRuns = pgTable(
  'production_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(), // e.g., "PR-2025-043"
    facilityId: uuid('facility_id')
      .notNull(),
    status: productionRunStatus('status').default('running').notNull(),

    // --- Overview ---
    // The run's physical time window. `startTime` is the natural key (with
    // reactor) and its date is the run's calendar date — the standalone `date`
    // column was dropped (issue #259); consumers derive it from `startTime`.
    startTime: timestamp('start_time').defaultNow().notNull(),
    // NULL = the run has started but not ended yet (an "open" run). A closed
    // run occupies [startTime, endTime); an open run occupies [startTime, ∞).
    endTime: timestamp('end_time'),
    reactorId: uuid('reactor_id')
      .notNull()
      .references(() => reactors.id),
    operatorId: uuid('operator_id').references(() => operators.id),

    // --- Processing Parameters (Isometric Protocol Section 9) ---
    feedingRateKgHr: real('feeding_rate_kg_hr'),
    residenceTimeMinutes: integer('residence_time_minutes'),

    // --- Energy Inputs (Isometric: Energy Use Accounting Module, Eq.6) ---
    dieselOperationLiters: real('diesel_operation_liters'),
    dieselGensetLiters: real('diesel_genset_liters'),
    preprocessingFuelLiters: real('preprocessing_fuel_liters'),
    electricityKwh: real('electricity_kwh'),
    // Isometric Energy Module §5.3 — EC1–EC5 electricity sourcing category
    electricitySourceCategory: electricitySourceCategory('electricity_source_category'),
    lowCarbonPercentage: real('low_carbon_percentage'), // % from renewables/low-carbon grid (0–100)

    // --- Biochar Output ---
    biocharOutputKg: massKg('biochar_output_kg'), // Wet mass (recorded value)
    biocharMoisturePercent: percent('biochar_moisture_percent'), // Typically 1-2%, default 0 if unknown
    biocharDryMassKg: massKg('biochar_dry_mass_kg'), // Derived: wetMass * (1 - moisture/100)
    biocharStorageLocationId: uuid('biochar_storage_location_id').references(
      () => storageLocations.id
    ),
    feedstockStorageLocationId: uuid('feedstock_storage_location_id').references(
      () => storageLocations.id
    ),
    feedstockWetMassKg: massKg('feedstock_wet_mass_kg'),
    feedstockMoisturePercent: percent('feedstock_moisture_percent'),
    feedstockMassDryKg: massKg('feedstock_mass_dry_kg'),

    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('production_runs_organization_id_code_unique').on(table.organizationId, table.code),
    unique('production_runs_id_organization_id_unique').on(table.id, table.organizationId),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    index('production_runs_facility_id_idx').on(table.facilityId),
    // A run's window must be forward in time (or still open). Mirrors the
    // server-side overlap guard (#259).
    check(
      'production_runs_end_after_start',
      sql`${table.endTime} is null or ${table.endTime} > ${table.startTime}`
    ),
    // One physical run per (reactor, start instant): two runs can't begin at the
    // same moment on the same reactor. Partial so voided/archived rows free the
    // slot. The server layer additionally rejects overlapping windows (#259).
    uniqueIndex('production_runs_reactor_start_unique_idx')
      .on(table.reactorId, table.startTime)
      .where(sql`${table.status} <> 'void' and ${table.archivedAt} is null`),
    check(
      'production_runs_feedstock_wet_mass_non_negative',
      sql`${table.feedstockWetMassKg} is null or ${table.feedstockWetMassKg} >= 0`
    ),
    check(
      'production_runs_feedstock_dry_mass_non_negative',
      sql`${table.feedstockMassDryKg} is null or ${table.feedstockMassDryKg} >= 0`
    ),
    check(
      'production_runs_feedstock_moisture_percent_range',
      sql`${table.feedstockMoisturePercent} is null or (${table.feedstockMoisturePercent} >= 0 and ${table.feedstockMoisturePercent} <= 100)`
    ),
    check(
      'production_runs_feedstock_dry_lte_wet',
      sql`${table.feedstockWetMassKg} is null or ${table.feedstockMassDryKg} is null or ${table.feedstockMassDryKg} <= ${table.feedstockWetMassKg}`
    ),
    check(
      'production_runs_biochar_moisture_percent_range',
      sql`${table.biocharMoisturePercent} is null or (${table.biocharMoisturePercent} >= 0 and ${table.biocharMoisturePercent} <= 100)`
    ),
    check(
      'production_runs_biochar_dry_mass_non_negative',
      sql`${table.biocharDryMassKg} is null or ${table.biocharDryMassKg} >= 0`
    ),
    check(
      'production_runs_biochar_dry_lte_wet',
      sql`${table.biocharOutputKg} is null or ${table.biocharDryMassKg} is null or ${table.biocharDryMassKg} <= ${table.biocharOutputKg}`
    ),
    check(
      'production_runs_low_carbon_percentage_range',
      sql`${table.lowCarbonPercentage} is null or (${table.lowCarbonPercentage} >= 0 and ${table.lowCarbonPercentage} <= 100)`
    ),
  ]
);

// ============================================
// Production Run Readings - Time-series monitoring data
// Isometric Protocol: Appendix II Monitoring Plan
// Temperature: 5-min intervals, Pressure/Emissions: 1-min intervals
// ============================================

export const productionRunReadings = pgTable(
  'production_run_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    productionRunId: uuid('production_run_id')
      .notNull(),

    timestamp: timestamp('timestamp').notNull(),

    // Temperature monitoring (5-min intervals required)
    temperatureC: real('temperature_c'),

    // Pressure monitoring (1-min intervals, required if reactor >0.5 bar)
    pressureBar: real('pressure_bar'),

    gasFlowRate: real('gas_flow_rate'), // m³/s or equivalent — retained for legacy imports; not in the canonical CSV format

    // Drive (VFD) frequencies — operator telemetry, internal-only (not
    // published to Isometric). Optional columns in the canonical readings CSV.
    dryerFrequencyHz: real('dryer_frequency_hz'),
    reactorFrequencyHz: real('reactor_frequency_hz'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('production_run_readings_organization_id_idx').on(table.organizationId),
    foreignKey({
      columns: [table.productionRunId, table.organizationId],
      foreignColumns: [productionRuns.id, productionRuns.organizationId],
    }),
    // One canonical reading per (run, UTC timestamp). The unique constraint is
    // the storage-level guarantee behind the idempotent readings import (#398):
    // re-importing a file inserts with ON CONFLICT DO NOTHING against this
    // index, so duplicate telemetry for the same reactor instant is impossible
    // and can never reach an Isometric sensor submission.
    uniqueIndex('production_run_readings_run_timestamp_uq').on(
      table.productionRunId,
      table.timestamp
    ),
  ]
);

// ============================================
// Samples - Biochar quality samples
// Isometric Protocol: Section 8.3 (Calculation of C_biochar)
// Biochar Storage in Soil Environments Module v1.2: Section 3, Table 2
// Supports Method A (every batch) and Method B (every 10th batch)
// Minimum 3 samples per production batch required
// ============================================

export const samples = pgTable('samples', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  // ADR 0016: a lab Sample characterises the CREDIT BATCH (the protocol
  // production batch) — its >=3 replicates' mean/std-dev. Drizzle keeps this
  // free of .references() to avoid a circular schema import with credits.ts;
  // migration 0057 adds the DB foreign key.
  creditBatchId: uuid('credit_batch_id'),
  // Provenance: which production run the sample was physically drawn from.
  // Nullable — batch biochar can be commingled across runs. (Was the primary
  // link pre-0015; now secondary to creditBatchId.)
  productionRunId: uuid('production_run_id'),
  // Unique per organization (issue #395, re-scoped for multi-tenancy #372):
  // DB-enforced via `samples_organization_id_sample_code_unique` so concurrent
  // creates can't duplicate a code within a tenant.
  sampleCode: text('sample_code').notNull(),
  samplingTime: timestamp('sampling_time').notNull(),
  weightGrams: real('weight_grams'),
  volumeMl: real('volume_ml'),

  // --- Lab ---
  labName: text('lab_name'),
  labAccreditation: text('lab_accreditation'),
  analysisDate: date('analysis_date'),

  // --- Carbon ---
  totalCarbonPercent: real('total_carbon_percent').notNull(),
  inorganicCarbonPercent: real('inorganic_carbon_percent'),
  organicCarbonPercent: real('organic_carbon_percent').notNull(),

  // --- Elemental ---
  totalHydrogenPercent: real('total_hydrogen_percent'),
  totalNitrogenPercent: real('total_nitrogen_percent'),
  totalOxygenPercent: real('total_oxygen_percent'),
  totalSulfurPercent: real('total_sulfur_percent'),

  // --- Proximate ---
  ashContentPercent: real('ash_content_percent'),
  moistureContentPercent: real('moisture_content_percent'),

  // --- Physical Properties (Isometric: Table 2) ---
  ph: real('ph'),
  bulkDensityKgPerM3: real('bulk_density_kg_per_m3'),
  saltContentGPerKg: real('salt_content_g_per_kg'),

  // --- Stability Ratios ---
  hToCOrgRatio: fraction('h_to_c_org_ratio'),
  oToCOrgRatio: fraction('o_to_c_org_ratio'),

  // --- Heavy Metals (mg/kg) ---
  arsenicMgKg: ppm('arsenic_mg_kg'),
  cadmiumMgKg: ppm('cadmium_mg_kg'),
  chromiumMgKg: ppm('chromium_mg_kg'),
  copperMgKg: ppm('copper_mg_kg'),
  leadMgKg: ppm('lead_mg_kg'),
  mercuryMgKg: ppm('mercury_mg_kg'),
  nickelMgKg: ppm('nickel_mg_kg'),
  zincMgKg: ppm('zinc_mg_kg'),

  // --- Contaminants ---
  pahTotalMgKg: ppm('pah_total_mg_kg'),
  pcbTotalMgKg: ppm('pcb_total_mg_kg'),
  dioxinsNgKg: ppm('dioxins_ng_kg'),
  furansNgKg: ppm('furans_ng_kg'),

  // --- Nutrients (%) ---
  phosphorusPercent: real('phosphorus_percent'),
  potassiumPercent: real('potassium_percent'),
  magnesiumPercent: real('magnesium_percent'),
  calciumPercent: real('calcium_percent'),
  ironPercent: real('iron_percent'),

  // --- 1000-Year Durability ---
  randomReflectanceR0Percent: real('random_reflectance_r0_percent'),
  r0MeasurementCount: integer('r0_measurement_count'),
  reactiveCarbonPercent: real('reactive_carbon_percent'),
  residualCarbonPercent: real('residual_carbon_percent'),
  // Per-sample `s_fraction` for the live `biochar_sequestration_1000_year`
  // blueprint (ADR 0021): the proportion (0–1) of THIS sample's R₀ readings
  // ≥ 2% — the inertinite fraction from the ISO 7404-5:2009 histogram. The
  // registry needs the full per-replicate list to compute the conservative
  // −binomial-SE durable fraction, so this is stored per sample, NOT collapsed
  // to a batch mean. Nullable (lab-supplied; not yet a form input — #348).
  // ⚠️ Whether the registry wants this computed proportion vs. the raw R₀
  // reading set is an open Isometric confirm (docs/open-questions.md).
  sReflectanceFraction: real('s_reflectance_fraction'),
  tgaAnalysisDate: date('tga_analysis_date'),
  r0AnalysisDate: date('r0_analysis_date'),
  r0HistogramFileUrl: text('r0_histogram_file_url'),
  tgaThermogramFileUrl: text('tga_thermogram_file_url'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('samples_organization_id_sample_code_unique').on(
    table.organizationId,
    table.sampleCode
  ),
  foreignKey({
    columns: [table.productionRunId, table.organizationId],
    foreignColumns: [productionRuns.id, productionRuns.organizationId],
  }),
]);

// ============================================
// Incident Reports - Production issues
// Isometric Protocol: Section 5 (Adaptive Management)
// ============================================

export const incidentReports = pgTable('incident_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  productionRunId: uuid('production_run_id')
    .notNull(),
  incidentTime: timestamp('incident_time').notNull(),
  incidentDate: timestamp('incident_date').defaultNow().notNull(),
  operatorId: uuid('operator_id').references(() => operators.id),
  reactorId: uuid('reactor_id').references(() => reactors.id),
  description: text('description').notNull(),
  severity: incidentSeverity('severity'),
  correctiveActions: text('corrective_actions'),
  notes: text('notes'), // e.g., "Machine running a bit hot"

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('incident_reports_organization_id_idx').on(table.organizationId),
  foreignKey({
    columns: [table.productionRunId, table.organizationId],
    foreignColumns: [productionRuns.id, productionRuns.organizationId],
  }),
]);

export const productionRunFeedstocks = pgTable('production_run_feedstocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  productionRunId: uuid('production_run_id')
    .notNull(),
  feedstockId: uuid('feedstock_id')
    .notNull()
    .references(() => feedstocks.id),
  massUsedKg: massKg('mass_used_kg').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('production_run_feedstocks_organization_id_idx').on(table.organizationId),
  foreignKey({
    columns: [table.productionRunId, table.organizationId],
    foreignColumns: [productionRuns.id, productionRuns.organizationId],
  }),
]);

// ============================================
// Production Samples - In-process sampling (~every 2h)
// Lightweight table for quick field measurements during pyrolysis
// ============================================

export const productionSamples = pgTable('production_samples', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  productionRunId: uuid('production_run_id')
    .notNull(),
  sampleCode: text('sample_code'),
  timestamp: timestamp('timestamp').notNull(),
  weightGrams: real('weight_grams'),
  volumeMl: real('volume_ml'),
  temperatureC: real('temperature_c'),
  moistureContentPercent: real('moisture_content_percent'),
  fixedCarbonPercent: real('fixed_carbon_percent'),
  volatileMatterPercent: real('volatile_matter_percent'),
  ashContentPercent: real('ash_content_percent'),
  photoUrl: text('photo_url'),
  sampledById: uuid('sampled_by_id').references(() => operators.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('production_samples_organization_id_idx').on(table.organizationId),
  foreignKey({
    columns: [table.productionRunId, table.organizationId],
    foreignColumns: [productionRuns.id, productionRuns.organizationId],
  }),
]);

// ============================================
// Relations
// ============================================

export const productionRunsRelations = relations(
  productionRuns,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [productionRuns.facilityId],
      references: [facilities.id],
    }),
    reactor: one(reactors, {
      fields: [productionRuns.reactorId],
      references: [reactors.id],
    }),
    operator: one(operators, {
      fields: [productionRuns.operatorId],
      references: [operators.id],
    }),
    biocharStorageLocation: one(storageLocations, {
      fields: [productionRuns.biocharStorageLocationId],
      references: [storageLocations.id],
      relationName: 'biocharStorageLocation',
    }),
    feedstockStorageLocation: one(storageLocations, {
      fields: [productionRuns.feedstockStorageLocationId],
      references: [storageLocations.id],
      relationName: 'feedstockStorageLocation',
    }),
    samples: many(samples),
    productionSamples: many(productionSamples),
    incidentReports: many(incidentReports),
    readings: many(productionRunReadings),
    productionRunFeedstocks: many(productionRunFeedstocks),
  })
);

export const productionRunReadingsRelations = relations(
  productionRunReadings,
  ({ one }) => ({
    productionRun: one(productionRuns, {
      fields: [productionRunReadings.productionRunId],
      references: [productionRuns.id],
    }),
  })
);

export const samplesRelations = relations(samples, ({ one }) => ({
  productionRun: one(productionRuns, {
    fields: [samples.productionRunId],
    references: [productionRuns.id],
  }),
}));

export const incidentReportsRelations = relations(incidentReports, ({ one }) => ({
  productionRun: one(productionRuns, {
    fields: [incidentReports.productionRunId],
    references: [productionRuns.id],
  }),
  operator: one(operators, {
    fields: [incidentReports.operatorId],
    references: [operators.id],
  }),
  reactor: one(reactors, {
    fields: [incidentReports.reactorId],
    references: [reactors.id],
  }),
}));

export const productionRunFeedstocksRelations = relations(
  productionRunFeedstocks,
  ({ one }) => ({
    productionRun: one(productionRuns, {
      fields: [productionRunFeedstocks.productionRunId],
      references: [productionRuns.id],
    }),
    feedstock: one(feedstocks, {
      fields: [productionRunFeedstocks.feedstockId],
      references: [feedstocks.id],
    }),
  })
);

export const productionSamplesRelations = relations(
  productionSamples,
  ({ one }) => ({
    productionRun: one(productionRuns, {
      fields: [productionSamples.productionRunId],
      references: [productionRuns.id],
    }),
    sampledBy: one(operators, {
      fields: [productionSamples.sampledById],
      references: [operators.id],
    }),
  })
);

export type ProductionRun = InferSelectModel<typeof productionRuns>;
export type ProductionRunReading = InferSelectModel<typeof productionRunReadings>;
export type Sample = InferSelectModel<typeof samples>;
export type ProductionSample = InferSelectModel<typeof productionSamples>;
