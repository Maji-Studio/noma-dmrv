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
  'failed',
  'cancelled',
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

// Material lane a bin-reconciliation movement applies to. Mirrors the three
// storage-location types (feedstock_bin / biochar_bin / product_bin) but named
// for the material so the movement ledger reads on its own.
export const binMovementLane = pgEnum('bin_movement_lane', [
  'feedstock',
  'biochar',
  'product',
]);

// Kind of reconciliation movement. `adjustment` = stock-take correction (the
// count didn't match), `loss` = a documented write-off (spoilage, spillage,
// failed run). Extensible later for `transfer` (#34).
export const binMovementType = pgEnum('bin_movement_type', [
  'adjustment',
  'loss',
]);

export const packagingType = pgEnum('packaging_type', ['loose', 'bagged']);

export const applicationMethod = pgEnum('application_method', [
  'manual',
  'mechanical',
]);

export const applicationEvidenceMethod = pgEnum('application_evidence_method', [
  'visual',
  'boundary',
]);

export const documentationType = pgEnum('documentation_type', [
  'weighbridge_ticket',
  'bill_of_lading',
  'other_transport_evidence',
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

// Immutable per-credit-batch sampling choice (ADR 0022).
export const creditBatchSampling = pgEnum('credit_batch_sampling', [
  'sampled',
  'unsampled',
]);

// Moisture-determination pathway a production process declares when it
// transitions to Method B (Biochar Protocol `R-ADXG-0`). One of three must be
// chosen at unlock; noma defaults to `measured_every_batch` (it already records
// per-run biochar moisture). The SEM-monitored `consistent_target_moisture`
// pathway is recordable but its < 5 % drift monitoring is out of scope (ADR 0017
// D7). Non-authoritative summary — verify against the protocol before relying on
// it for credit claims.
export const moisturePathway = pgEnum('moisture_pathway', [
  'dry_weight_every_batch', // (1) dry-weight every batch, volume-traceable
  'consistent_target_moisture', // (2) consistent target moisture, SEM < 5 %
  'measured_every_batch', // (3) moisture measured every batch (noma default)
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
  'document', // backed by classified transport evidence
]);

// Transport trip type (Isometric GHG Accounting Module v1.1, "Transportation
// Emissions" — Distance-Based Method). `return` = full round trip assumed
// (vehicle returns empty / next destination unknown — the conservative
// protocol default); `one_way` = evidenced onward destination, distance
// counted one-way only. Drives the ×2 round-trip multiplier at the
// mass-distance aggregation seam (issue #316). Orthogonal to distanceSource.
export const transportTripType = pgEnum('transport_trip_type', [
  'return',
  'one_way',
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
  'certification_submission_status',
  [
    'draft',
    'submitted',
    'accepted',
    'rejected',
    'superseded',
  ]
);

// (The `project_emission_category` pgEnum lived here for the ADR 0005
// LCA journal; removed per ADR 0018. The category strings survive as
// self-contained literals in PERIOD_INPUT_TUPLES,
// src/lib/isometric/transformers/datapoint.ts.)
