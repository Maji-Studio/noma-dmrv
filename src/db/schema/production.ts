import {
  boolean,
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

export const productionRuns = pgTable('production_runs', {
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

  // --- Feedstock Input ---
  feedstockMix: text('feedstock_mix'), // e.g., "Mixed Wood Chips"
  feedstockStorageLocationId: uuid('feedstock_storage_location_id').references(
    () => storageLocations.id
  ),
  feedstockAmountKg: real('feedstock_amount_kg'),
  feedingRateKgHr: real('feeding_rate_kg_hr'),
  moistureBeforeDryingPercent: real('moisture_before_drying_percent'),
  moistureAfterDryingPercent: real('moisture_after_drying_percent'),

  // --- Biochar Output ---
  biocharAmountKg: real('biochar_amount_kg'),
  biocharDryWeightKg: real('biochar_dry_weight_kg'),
  biocharWetWeightKg: real('biochar_wet_weight_kg'),
  biocharDryMoisturePercent: real('biochar_dry_moisture_percent'),
  uncarbonizedBiocharKg: real('uncarbonized_biochar_kg'),
  yieldPercent: real('yield_percent'), // Calculated: (biochar/feedstock)*100
  biocharStorageLocationId: uuid('biochar_storage_location_id').references(
    () => storageLocations.id
  ),

  // --- Processing Parameters (Isometric Protocol Section 9) ---
  // Pyrolysis monitoring requirements
  pyrolysisTemperatureC: real('pyrolysis_temperature_c'), // Continuous monitoring
  temperatureCelsius: real('temperature_celsius'),
  residenceTimeMinutes: integer('residence_time_minutes'), // Process parameter

  // Energy accounting (Isometric: Energy Use Accounting Module)
  dieselOperationLiters: real('diesel_operation_liters'),
  dieselGensetLiters: real('diesel_genset_liters'),
  preprocessingFuelLiters: real('preprocessing_fuel_liters'),
  electricityKwh: real('electricity_kwh'),

  // --- Processing Data ---
  plcDataFileUrl: text('plc_data_file_url'), // URL to uploaded PLC CSV data file

  // --- Emissions (Isometric Protocol Section 8.6) ---
  emissionsFromFossilsKg: real('emissions_from_fossils_kg'), // Calculated
  emissionsFromGridKg: real('emissions_from_grid_kg'), // Calculated
  totalEmissionsKg: real('total_emissions_kg'), // Calculated
  energyEmissionsCo2eKg: real('energy_emissions_co2e_kg'),
  totalEmissionsCo2eKg: real('total_emissions_co2e_kg'),
  emissionFactorsUsed: jsonb('emission_factors_used'),

  // --- Quenching ---
  quenchingDryWeightKg: real('quenching_dry_weight_kg'),
  quenchingWetWeightKg: real('quenching_wet_weight_kg'),
  biocharOutputKg: real('biochar_output_kg'),
  yieldPercentage: real('yield_percentage'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Production Run Readings - Time-series monitoring data
// Isometric Protocol: Appendix II Monitoring Plan
// Temperature: 5-min intervals, Pressure/Emissions: 1-min intervals
// ============================================

export const productionRunReadings = pgTable(
  'production_run_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productionRunId: uuid('production_run_id')
      .notNull()
      .references(() => productionRuns.id),

    timestamp: timestamp('timestamp').notNull(),

    // Temperature monitoring (5-min intervals required)
    temperatureC: real('temperature_c'),
    temperatureCelsius: real('temperature_celsius'),

    // Pressure monitoring (1-min intervals, required if reactor >0.5 bar)
    pressureBar: real('pressure_bar'),
    continuousGasMeasurement: boolean('continuous_gas_measurement')
      .notNull()
      .default(false),

    // Emissions monitoring (1-min intervals, Option 1: continuous measurement)
    ch4Composition: real('ch4_composition'), // Methane
    n2oComposition: real('n2o_composition'), // Nitrous oxide
    coComposition: real('co_composition'), // Carbon monoxide
    co2Composition: real('co2_composition'), // Carbon dioxide
    gasFlowRate: real('gas_flow_rate'), // m³/s or equivalent
    ch4Ppm: real('ch4_ppm'),
    n2oPpm: real('n2o_ppm'),
    coPpm: real('co_ppm'),
    co2Ppm: real('co2_ppm'),
    flowRate: real('flow_rate'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'production_run_readings_ppm_required_when_continuous',
      sql`${table.continuousGasMeasurement} = false or (
        ${table.ch4Ppm} is not null and
        ${table.n2oPpm} is not null and
        ${table.coPpm} is not null and
        ${table.co2Ppm} is not null
      )`
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

export const samples = pgTable(
  'samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productionRunId: uuid('production_run_id')
      .notNull()
      .references(() => productionRuns.id),
    samplingTime: timestamp('sampling_time').notNull(),
    operatorId: uuid('operator_id').references(() => operators.id),
    reactorId: uuid('reactor_id').references(() => reactors.id),

  // --- Sampling Details ---
  sampleCode: text('sample_code').notNull(),
  weightG: real('weight_g'),
  weightGrams: real('weight_grams'),
  volumeMl: real('volume_ml'),
  temperatureC: real('temperature_c'),
  analysisDate: date('analysis_date'),

  // --- Carbon Measurements (Isometric: Table 2) ---
  // Total Carbon Content (Required - ISO 29541 or ASTM D5373)
  totalCarbonPercent: real('total_carbon_percent').notNull(),
  // Inorganic Carbon (Required - ISO 16948 or ASTM D4373)
  inorganicCarbonPercent: real('inorganic_carbon_percent'),
  // Organic Carbon (Calculated: Total C - Inorganic C)
  organicCarbonPercent: real('organic_carbon_percent').notNull(),

  // Legacy field - keeping for backward compatibility
  carbonContentPercent: real('carbon_content_percent'),

  // --- Elemental Analysis (Isometric: Table 2) ---
  hydrogenContentPercent: real('hydrogen_content_percent'), // Required - ISO 29541/ASTM D5373
  totalHydrogenPercent: real('total_hydrogen_percent'),
  oxygenContentPercent: real('oxygen_content_percent'), // Required - ISO 16948/DIN 51733
  totalOxygenPercent: real('total_oxygen_percent'),
  nitrogenPercent: real('nitrogen_percent'), // Required - ISO 29541/ASTM D5373
  totalNitrogenPercent: real('total_nitrogen_percent'),
  sulfurPercent: real('sulfur_percent'), // Required - ISO 15178/DIN 51724
  totalSulfurPercent: real('total_sulfur_percent'),

  // --- Stability Ratios (Isometric: Table 2) ---
  // H:Corg molar ratio (Required, threshold < 0.5 for eligibility)
  hCorgMolarRatio: real('h_corg_molar_ratio'),
  hToCOrgRatio: real('h_to_c_org_ratio'),
  // O:Corg molar ratio (Required, threshold < 0.2 for eligibility)
  oCorgMolarRatio: real('o_corg_molar_ratio'),
  oToCOrgRatio: real('o_to_c_org_ratio'),

  // --- Proximate Analysis ---
  moisturePercent: real('moisture_percent'), // Required - ISO 18134/ASTM D1762
  moistureContentPercent: real('moisture_content_percent'),
  ashPercent: real('ash_percent'), // Required - ISO 18122/ISO 1171
  ashContentPercent: real('ash_content_percent'),
  volatileMatterPercent: real('volatile_matter_percent'), // Recommended - ASTM D1762
  fixedCarbonPercent: real('fixed_carbon_percent'), // Recommended

  // --- Physical Properties (Isometric: Table 2) ---
  ph: real('ph'), // Required - ISO 10390
  saltContentGPerKg: real('salt_content_g_per_kg'), // Required - ISO 10390
  bulkDensityKgPerM3: real('bulk_density_kg_per_m3'), // Required (<3mm) - ISO 17828
  waterHoldingCapacityPercent: real('water_holding_capacity_percent'), // Recommended - ISO 14238

  // --- Heavy Metals (Isometric: Table 2 - all REQUIRED with thresholds) ---
  leadMgPerKg: real('lead_mg_per_kg'), // ≤300 mg/kg DM
  leadMgKg: real('lead_mg_kg'),
  cadmiumMgPerKg: real('cadmium_mg_per_kg'), // ≤5 mg/kg DM
  cadmiumMgKg: real('cadmium_mg_kg'),
  copperMgPerKg: real('copper_mg_per_kg'), // ≤200 mg/kg DM
  copperMgKg: real('copper_mg_kg'),
  nickelMgPerKg: real('nickel_mg_per_kg'), // ≤100 mg/kg DM
  nickelMgKg: real('nickel_mg_kg'),
  mercuryMgPerKg: real('mercury_mg_per_kg'), // ≤2 mg/kg DM
  mercuryMgKg: real('mercury_mg_kg'),
  zincMgPerKg: real('zinc_mg_per_kg'), // ≤1000 mg/kg DM
  zincMgKg: real('zinc_mg_kg'),
  chromiumMgPerKg: real('chromium_mg_per_kg'), // ≤200 mg/kg DM
  chromiumMgKg: real('chromium_mg_kg'),
  arsenicMgPerKg: real('arsenic_mg_per_kg'), // ≤20 mg/kg DM
  arsenicMgKg: real('arsenic_mg_kg'),

  // --- Contaminants (Isometric: Table 2 - all REQUIRED) ---
  pahsEfsa8MgPerKg: real('pahs_efsa8_mg_per_kg'), // ≤1 g/t DM (EFSA 8)
  pahTotalMgKg: real('pah_total_mg_kg'),
  pahsEpa16MgPerKg: real('pahs_epa16_mg_per_kg'), // Declaration (EPA 16)
  pcddFNgPerKg: real('pcdd_f_ng_per_kg'), // ≤20 ng/kg DM (17 PCDD/F)
  dioxinsNgKg: real('dioxins_ng_kg'),
  furansNgKg: real('furans_ng_kg'),
  pcbMgPerKg: real('pcb_mg_per_kg'), // ≤0.2 mg/kg DM (12 WHO PCB)
  pcbTotalMgKg: real('pcb_total_mg_kg'),

    // --- Nutrients Declaration (required only for nutrient/fertilizer claim pathway) ---
    nutrientClaimEnabled: boolean('nutrient_claim_enabled')
      .notNull()
      .default(false),
    phosphorusGPerKg: real('phosphorus_g_per_kg'),
    phosphorusPercent: real('phosphorus_percent'),
    potassiumGPerKg: real('potassium_g_per_kg'),
    potassiumPercent: real('potassium_percent'),
    magnesiumGPerKg: real('magnesium_g_per_kg'),
    magnesiumPercent: real('magnesium_percent'),
    calciumGPerKg: real('calcium_g_per_kg'),
    calciumPercent: real('calcium_percent'),
    ironGPerKg: real('iron_g_per_kg'),
    ironPercent: real('iron_percent'),

    // --- 1000-Year Durability Fields (Isometric: Table 3 - Optional) ---
    // Required only for 1000-year durability crediting option
    randomReflectanceR0: real('random_reflectance_r0'), // >2% for inertinite (ISO 7404-5, 500+ measurements)
    randomReflectanceR0Percent: real('random_reflectance_r0_percent'),
    r0MeasurementCount: integer('r0_measurement_count'), // Must total >= 500 per batch
    residualOrganicCarbonPercent: real('residual_organic_carbon_percent'), // Non-reactive carbon from TGA
    residualCarbonPercent: real('residual_carbon_percent'),
    reactiveCarbonPercent: real('reactive_carbon_percent'), // Reactive carbon from TGA
    tgaAnalysisDate: date('tga_analysis_date'), // Thermogravimetric analysis date
    r0AnalysisDate: date('r0_analysis_date'), // Random reflectance analysis date
    r0HistogramFileUrl: text('r0_histogram_file_url'), // Evidence: R₀ histogram
    tgaThermogramFileUrl: text('tga_thermogram_file_url'), // Evidence: TGA thermogram

    // --- Lab Information (Isometric: ISO 17025 compliance) ---
    labName: text('lab_name'),
    labAccreditationNumber: text('lab_accreditation_number'), // ISO 17025 accreditation
    labAccreditation: text('lab_accreditation'),
    analysisMethod: text('analysis_method'), // e.g., "ASTM D5291", "ISO 29541"
    labAnalysisAt: timestamp('lab_analysis_at'),
    iso17025Accreditation: boolean('iso_17025_accreditation'),
    labResults: jsonb('lab_results'),
    labAnalystName: text('lab_analyst_name'),
    labReportFileUrl: text('lab_report_file_url'),
    labReportFile: text('lab_report_file'),

    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'samples_nutrients_required_when_claim_enabled',
      sql`${table.nutrientClaimEnabled} = false or (
        ${table.phosphorusGPerKg} is not null and
        ${table.potassiumGPerKg} is not null and
        ${table.magnesiumGPerKg} is not null and
        ${table.calciumGPerKg} is not null and
        ${table.ironGPerKg} is not null
      )`
    ),
  ]
);

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
    feedstockStorageLocation: one(storageLocations, {
      fields: [productionRuns.feedstockStorageLocationId],
      references: [storageLocations.id],
      relationName: 'feedstockStorage',
    }),
    biocharStorageLocation: one(storageLocations, {
      fields: [productionRuns.biocharStorageLocationId],
      references: [storageLocations.id],
      relationName: 'biocharStorage',
    }),
    samples: many(samples),
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
  operator: one(operators, {
    fields: [samples.operatorId],
    references: [operators.id],
  }),
  reactor: one(reactors, {
    fields: [samples.reactorId],
    references: [reactors.id],
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
