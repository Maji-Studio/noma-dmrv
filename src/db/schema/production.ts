import {
  check,
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  date,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { incidentSeverity, productionRunStatus } from './common';
import { facilities, reactors, storageLocations } from './facilities';
import { operators } from './parties';
import { feedstocks } from './feedstock';

// ============================================
// Production Runs - Pyrolysis batches
// Isometric Protocol: Section 9 (Pyrolysis Reactor System Requirements)
// ============================================

export const productionRuns = pgTable(
  'production_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "PR-2025-043"
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    date: date('date').notNull(),
    status: productionRunStatus('status').default('running').notNull(),

    // --- Overview ---
    startTime: timestamp('start_time').defaultNow().notNull(),
    endTime: timestamp('end_time').defaultNow().notNull(),
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

    // --- Biochar Output ---
    biocharOutputKg: real('biochar_output_kg'),
    biocharStorageLocationId: uuid('biochar_storage_location_id').references(
      () => storageLocations.id
    ),
    feedstockStorageLocationId: uuid('feedstock_storage_location_id').references(
      () => storageLocations.id
    ),
    feedstockWetMassKg: real('feedstock_wet_mass_kg'),
    feedstockMoisturePercent: real('feedstock_moisture_percent'),
    feedstockMassDryKg: real('feedstock_mass_dry_kg'),

    // --- Metadata ---
    emissionFactorsUsed: jsonb('emission_factors_used'), // Snapshot of factors used
    plcDataFileUrl: text('plc_data_file_url'), // URL to uploaded PLC CSV data file

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
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
  ]
);

// ============================================
// Production Run Readings - Time-series monitoring data
// Isometric Protocol: Appendix II Monitoring Plan
// Temperature: 5-min intervals, Pressure/Emissions: 1-min intervals
// ============================================

export const productionRunReadings = pgTable('production_run_readings', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionRunId: uuid('production_run_id')
    .notNull()
    .references(() => productionRuns.id),

  timestamp: timestamp('timestamp').notNull(),

  // Temperature monitoring (5-min intervals required)
  temperatureC: real('temperature_c'),

  // Pressure monitoring (1-min intervals, required if reactor >0.5 bar)
  pressureBar: real('pressure_bar'),

  gasFlowRate: real('gas_flow_rate'), // m³/s or equivalent

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================
// Samples - Biochar quality samples
// Isometric Protocol: Section 8.3 (Calculation of C_biochar)
// Biochar Storage in Soil Environments Module v1.2: Section 3, Table 2
// Supports Method A (every batch) and Method B (every 10th batch)
// Minimum 3 samples per production batch required
// ============================================

export const samples = pgTable('samples', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionRunId: uuid('production_run_id')
    .notNull()
    .references(() => productionRuns.id),
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
  hToCOrgRatio: real('h_to_c_org_ratio'),
  oToCOrgRatio: real('o_to_c_org_ratio'),

  // --- Heavy Metals (mg/kg) ---
  arsenicMgKg: real('arsenic_mg_kg'),
  cadmiumMgKg: real('cadmium_mg_kg'),
  chromiumMgKg: real('chromium_mg_kg'),
  copperMgKg: real('copper_mg_kg'),
  leadMgKg: real('lead_mg_kg'),
  mercuryMgKg: real('mercury_mg_kg'),
  nickelMgKg: real('nickel_mg_kg'),
  zincMgKg: real('zinc_mg_kg'),

  // --- Contaminants ---
  pahTotalMgKg: real('pah_total_mg_kg'),
  pcbTotalMgKg: real('pcb_total_mg_kg'),
  dioxinsNgKg: real('dioxins_ng_kg'),
  furansNgKg: real('furans_ng_kg'),

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
  tgaAnalysisDate: date('tga_analysis_date'),
  r0AnalysisDate: date('r0_analysis_date'),
  r0HistogramFileUrl: text('r0_histogram_file_url'),
  tgaThermogramFileUrl: text('tga_thermogram_file_url'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Incident Reports - Production issues
// Isometric Protocol: Section 5 (Adaptive Management)
// ============================================

export const incidentReports = pgTable('incident_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionRunId: uuid('production_run_id')
    .notNull()
    .references(() => productionRuns.id),
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
});

export const productionRunFeedstocks = pgTable('production_run_feedstocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionRunId: uuid('production_run_id')
    .notNull()
    .references(() => productionRuns.id),
  feedstockId: uuid('feedstock_id')
    .notNull()
    .references(() => feedstocks.id),
  massUsedKg: real('mass_used_kg').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================
// Production Samples - In-process sampling (~every 2h)
// Lightweight table for quick field measurements during pyrolysis
// ============================================

export const productionSamples = pgTable('production_samples', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionRunId: uuid('production_run_id')
    .notNull()
    .references(() => productionRuns.id),
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
});

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
