import {
  check,
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  date,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { applicationStatus, applicationMethod } from './common';
import { facilities } from './facilities';
import { deliveries } from './logistics';

// ============================================
// Applications - Field application of biochar to soil
// Isometric Protocol: Biochar Storage in Soil Environments Module v1.2
// Section 5: Durability of Biochar in Soils
// ============================================

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "AP-2025-043"
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    applicationDate: timestamp('application_date').defaultNow().notNull(),
    status: applicationStatus('status').default('delivered').notNull(),

    // --- Linked Records ---
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id),

    // --- Application Details (Isometric: Soil Storage Module) ---
    biocharAppliedTons: real('biochar_applied_tons').notNull(),
    biocharAppliedDryTons: real('biochar_applied_dry_tons').notNull(),
    biocharDryMatterTons: real('biochar_dry_matter_tons'),
    totalAppliedTons: real('total_applied_tons'), // Calculated
    averageApplicationRateMagnitude: real('average_application_rate_magnitude'),
    averageApplicationRateUnit: text('average_application_rate_unit'),

    // GPS coordinates (Isometric requirement for soil storage)
    gpsLatitude: real('gps_latitude'),
    gpsLongitude: real('gps_longitude'),

    // Field details
    fieldSizeHa: real('field_size_ha'),
    fieldSizeHectares: real('field_size_hectares'),
    cropType: text('crop_type'),
    applicationMethodType: applicationMethod('application_method'), // manual/mechanical
    fieldIdentifier: text('field_identifier'), // Field name/parcel ID
    gisBoundaryReference: text('gis_boundary_reference'), // Link to GIS layer data

    // --- CO2e Calculation Results ---
    // Durability inputs (soil temp, H:Corg) are at Credit Batch level
    // These are the per-application calculated outputs
    co2eStoredTonnes: real('co2e_stored_tonnes'), // This application's contribution
    co2eStoredTons: real('co2e_stored_tons'),

    // --- Truck Weighing (Isometric: BiocharApplication requirement) ---
    truckMassOnArrivalKg: real('truck_mass_on_arrival_kg'),
    truckMassOnDepartureKg: real('truck_mass_on_departure_kg'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'applications_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'applications_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
  ]
);

// ============================================
// Soil Temperature Measurements - Baseline data for 200-year durability
// Isometric: SubRequirement G-QMBJ-0
// Requires at least 10 measurements per site-month for baseline
// ============================================

export const soilTemperatureMeasurements = pgTable(
  'soil_temperature_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),

    measurementDate: date('measurement_date').notNull(),
    temperatureC: real('temperature_c').notNull(),
    temperatureCelsius: real('temperature_celsius'),

    // Measurement method (ISO 4974 or equivalent)
    measurementMethod: text('measurement_method'),
    measurementApproach: text('measurement_approach'),
    measurementDepthCm: real('measurement_depth_cm'),
    depthCm: real('depth_cm'),

    // Location within field
    gpsLatitude: real('gps_latitude'),
    gpsLongitude: real('gps_longitude'),

    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'soil_temperature_measurements_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'soil_temperature_measurements_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
  ]
);

// ============================================
// Relations
// ============================================

export const applicationsRelations = relations(
  applications,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [applications.facilityId],
      references: [facilities.id],
    }),
    delivery: one(deliveries, {
      fields: [applications.deliveryId],
      references: [deliveries.id],
    }),
    soilTemperatureMeasurements: many(soilTemperatureMeasurements),
  })
);

export const soilTemperatureMeasurementsRelations = relations(
  soilTemperatureMeasurements,
  ({ one }) => ({
    application: one(applications, {
      fields: [soilTemperatureMeasurements.applicationId],
      references: [applications.id],
    }),
  })
);
