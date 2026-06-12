import { pgEnum } from 'drizzle-orm/pg-core';

// ============================================
// Status Enums (Chain of Custody)
// ============================================

export const feedstockStatus = pgEnum('feedstock_status', [
  'missing_data',
  'complete',
]);

export const productionRunStatus = pgEnum('production_run_status', [
  'draft',
  'running',
  'complete',
  'void',
]);

export const biocharProductStatus = pgEnum('biochar_product_status', [
  'draft',
  'testing',
  'ready',
  'sold',
]);

export const deliveryStatus = pgEnum('delivery_status', [
  'upcoming',
  'delivered',
]);

export const applicationStatus = pgEnum('application_status', [
  'delivered',
  'applied',
]);

export const creditBatchStatus = pgEnum('credit_batch_status', [
  'draft',
  'pending',
  'verified',
  'issued',
  'rejected',
]);

// ============================================
// Type Enums
// ============================================

export const storageLocationType = pgEnum('storage_location_type', [
  'feedstock_bin',
  'biochar_bin',
  'product_bin',
]);

export const feedstockTypeUsage = pgEnum('feedstock_type_usage', [
  'pyrolysis',
  'blend',
]);

export const packagingType = pgEnum('packaging_type', ['loose', 'bagged']);

export const applicationMethod = pgEnum('application_method', [
  'manual',
  'mechanical',
]);

export const documentationType = pgEnum('documentation_type', [
  'weighbridge_ticket',
  'bill_of_lading',
  'lab_report',
  'delivery_receipt',
  'invoice',
  'pdd',
  'affidavit',
  'calibration_certificate',
  'photo',
  'video',
  'pdf',
  'sensor_data',
]);

export const documentVisibility = pgEnum('document_visibility', [
  'private',
  'public',
]);

export const documentUploadStatus = pgEnum('document_upload_status', [
  'pending',
  'uploaded',
  'failed',
]);

export const incidentSeverity = pgEnum('incident_severity', [
  'low',
  'medium',
  'high',
]);

export const userRole = pgEnum('user_role', [
  'admin',
  'operator',
  'lab_technician',
  'viewer',
]);

// ============================================
// Isometric Protocol Enums
// ============================================

// Durability crediting options (Biochar Storage in Soil Environments Module v1.2)
// Section 5.1: Option 1 = 200-year, Option 2 = 1000-year
export const durabilityOption = pgEnum('durability_option', [
  '200_year', // Based on H:Corg ratio + soil temperature (Woolf et al., 2021)
  '1000_year', // Based on random reflectance R0 (Sanei et al., 2024)
]);

// Soil temperature data source (Soil Storage Module §5.1.1.3.1)
export const soilTemperatureSource = pgEnum('soil_temperature_source', [
  'baseline', // Measured directly on site (≥10 measurements/site-month)
  'global_database', // From approved global temperature dataset
]);

// Biochar sampling pathways (Biochar Protocol §8.3.1)
export const samplingMethod = pgEnum('sampling_method', [
  'method_a', // Sample every production batch
  'method_b', // Sample at least 1 in 10 production batches
]);

export const transportEntityType = pgEnum('transport_entity_type', [
  'feedstock',
  'biochar',
  'sample',
]);

// Transport methods (Transportation Emissions Accounting Module v1.1)
export const transportMethod = pgEnum('transport_method', [
  'road',
  'rail',
  'ship',
  'pipeline',
  'aircraft',
]);

// Provenance of a stored road distance (map integration plan, decision 2).
// Tracked on every surface where a distance can be written. A routed
// distance is an ESTIMATE (suggested default, operator-editable) in the
// same measured-vs-derived family as an emission estimate; document-backed
// distances (bill of lading, weigh ticket) remain the authoritative form.
// Orthogonal to a transport leg's isDerived flag.
export const distanceSource = pgEnum('distance_source', [
  'map_estimate', // CALC'd via OpenRouteService road routing
  'manual', // hand-typed by the operator
  'document', // backed by a bill of lading / weigh ticket
]);

// Emissions calculation method (Transportation Emissions Accounting Module v1.1)
// Section 3.2: Energy Usage Method (preferred), Section 3.3: Distance-Based Method
export const emissionsCalculationMethod = pgEnum('emissions_calculation_method', [
  // distance_based only — we submit distance + cargo mass; the Isometric
  // component blueprint holds the emission factor (Eq. 3). energy_usage was
  // removed: we never metered fuel, so fuel-based accounting was never real.
  'distance_based', // Uses distance + weight + emission factor (Isometric Eq. 3)
]);

// ============================================
// Isometric Compliance Enums
// ============================================

// Electricity sourcing category (Energy Use Accounting Module §5.3, EC1–EC5)
export const electricitySourceCategory = pgEnum('electricity_source_category', [
  'ec1_grid_average',
  'ec2_ppa',
  'ec3_eac',
  'ec4_cod',
  'ec5_direct_connection',
]);

// Feedstock eligibility status (Biomass Feedstock Accounting Module — >25% ineligible cap)
export const feedstockEligibilityStatus = pgEnum('feedstock_eligibility_status', [
  'eligible',
  'ineligible',
  'conditional',
]);

export const lossEntityType = pgEnum('loss_entity_type', [
  'production_run',
  'delivery',
  'application',
  'storage',
]);

export const lossTypeCode = pgEnum('loss_type_code', [
  'residue',
  'spillage',
  'runoff',
  'volatilization',
  'transport_loss',
  'other',
]);

export const certifierProvider = pgEnum('certifier_provider', [
  'isometric',
  'puro_earth',
  'verra',
]);

export const syncStatus = pgEnum('sync_status', [
  'pending',
  'succeeded',
  'failed',
]);

// Certifier submission lifecycle state.
export const certificationSubmissionStatus = pgEnum(
  'isometric_submission_status',
  [
    'draft',
    'submitted',
    'accepted',
    'rejected',
    'superseded',
  ]
);

// Per-reporting-period LCA emission categories (ADR 0005). These live as
// PROJECT-scope Components in Isometric (amortized server-side via the
// ProjectComponentAmortizationStrategy enum) — noma is the LCA journal
// (`/admin/emission-estimates` rows), not the publisher. Each enum value
// pins to one Isometric blueprint key (capturing its primary scalar input
// for drift matching); secondary inputs on the same Component are managed
// by the operator in the Isometric UI per the LCA document. The
// blueprint mapping lives in CATEGORY_TO_BLUEPRINT in
// src/lib/isometric/utils/project-emission-match.ts.
//
// `lab_electricity` (`grid_electricity_use`) and `sampling_consumables`
// (`mass_based_ci_emissions`) are split because they're two distinct
// Isometric Components under the `sampling-required-for-mrv` group; one
// noma row would not match cleanly.
export const projectEmissionCategory = pgEnum('project_emission_category', [
  'staff_travel',
  'pyrolyzer_direct',
  'biochar_storage_fuel',
  'miscellaneous',
  'lab_electricity',
  'sampling_consumables',
]);
