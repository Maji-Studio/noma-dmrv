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

export const orderStatus = pgEnum('order_status', ['draft', 'ordered', 'processed']);

export const deliveryStatus = pgEnum('delivery_status', [
  'scheduled',
  'processing',
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
  'feedstock_pile',
  'biochar_pile',
  'product_pile',
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

export const transportEntityType = pgEnum('transport_entity_type', [
  'feedstock',
  'biochar',
  'sample',
  'delivery',
]);

// Transport methods (Transportation Emissions Accounting Module v1.1)
export const transportMethod = pgEnum('transport_method', [
  'road',
  'rail',
  'ship',
  'pipeline',
  'aircraft',
]);

// Emissions calculation method (Transportation Emissions Accounting Module v1.1)
// Section 3.2: Energy Usage Method (preferred), Section 3.3: Distance-Based Method
export const emissionsCalculationMethod = pgEnum('emissions_calculation_method', [
  'energy_usage', // Uses fuel consumption + emission factors
  'distance_based', // Uses distance + weight + emission factors
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
