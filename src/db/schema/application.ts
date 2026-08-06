import { check, doublePrecision, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid, real, date } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { GisBoundary } from "@/lib/geojson/types";
import {
  applicationEvidenceMethod,
  applicationStatus,
  applicationMethod,
  soilTemperatureSource,
} from "./common";
import { deliveries } from "./logistics";
import { tonnes } from "./numeric-families";
import { organizations } from "./auth";

// ============================================
// Applications - Field application of biochar to soil
// Isometric Protocol: Biochar Storage in Soil Environments Module v1.2
// Section 5: Durability of Biochar in Soils
// ============================================

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(), // e.g., "AP-2025-043"
    applicationDate: timestamp("application_date").defaultNow().notNull(),
    status: applicationStatus("status").default("applied").notNull(),

    // --- Linked Records ---
    // Facility is derivable via delivery.facility_id (chain of custody)
    deliveryId: uuid("delivery_id")
      .notNull(),

    // --- Application Details (Isometric: Soil Storage Module) ---
    biocharAppliedTons: tonnes("biochar_applied_tons").notNull(),
    // Server-authoritative dry biochar allocated from the linked delivery.
    biocharAppliedDryTons: tonnes("biochar_applied_dry_tons").notNull(),
    // Derived fields (compute at query time):
    //   - biochar_dry_matter_tons = biochar_applied_dry_tons × (1 - ash_content/100) via lab samples
    //   - total_applied_tons = biochar_applied_tons + amendments via formulation ratios
    //   - average_application_rate = biochar_applied_tons / field_size_ha

    // GPS coordinates (Isometric requirement for soil storage)
    gpsLatitude: doublePrecision("gps_latitude"),
    gpsLongitude: doublePrecision("gps_longitude"),

    // Field details
    fieldSizeHa: real("field_size_ha"),
    cropType: text("crop_type"),
    applicationMethodType: applicationMethod("application_method"), // manual/mechanical
    fieldIdentifier: text("field_identifier"), // Field name/parcel ID
    evidenceMethod: applicationEvidenceMethod("evidence_method")
      .default("visual")
      .notNull(),
    gisBoundary: jsonb("gis_boundary").$type<GisBoundary>(),

    // --- Soil Temperature (Isometric: Soil Storage Module §5.1.1.3.1) ---
    // Used in 200-year durability equation: F_durable,200 = min(0.95, 1 - [c + (a + b·ln(T_soil))·H/C_org])
    // Source determines how soil_temperature_c is obtained:
    //   'baseline' → computed from soil_temperature_measurements (≥10/site-month)
    //   'global_database' → from approved external dataset
    soilTemperatureSource: soilTemperatureSource("soil_temperature_source"),
    soilTemperatureC: real("soil_temperature_c"), // Annual average for this application site

    // --- CO2e Calculation Results ---
    // These are the per-application calculated outputs
    co2eStoredTonnes: tonnes("co2e_stored_tonnes"), // This application's contribution

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("applications_organization_id_code_unique").on(table.organizationId, table.code),
    unique("applications_id_organization_id_unique").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.deliveryId, table.organizationId],
      foreignColumns: [deliveries.id, deliveries.organizationId],
    }),
    check(
      "applications_gps_latitude_range",
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`,
    ),
    check(
      "applications_gps_longitude_range",
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`,
    ),
    // Mirror the Zod range (-50..60 °C) and the certifier_projects /
    // customer_locations default-soil-temperature constraints so a direct SQL
    // write can't verify a 200-year batch off a nonsensical temperature.
    check(
      "applications_soil_temperature_c_range",
      sql`${table.soilTemperatureC} is null or (${table.soilTemperatureC} >= -50 and ${table.soilTemperatureC} <= 60)`,
    ),
  ],
);

// ============================================
// Soil Temperature Measurements - Baseline data for 200-year durability
// Isometric: SubRequirement G-QMBJ-0
// Requires at least 10 measurements per site-month for baseline
// ============================================

export const soilTemperatureMeasurements = pgTable(
  "soil_temperature_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    applicationId: uuid("application_id")
      .notNull(),

    measurementDate: date("measurement_date").notNull(),
    temperatureC: real("temperature_c").notNull(),

    // Measurement method (ISO 4974 or equivalent)
    measurementMethod: text("measurement_method"),
    measurementDepthCm: real("measurement_depth_cm"),

    // Location within field
    gpsLatitude: doublePrecision("gps_latitude"),
    gpsLongitude: doublePrecision("gps_longitude"),

    notes: text("notes"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("soil_temperature_measurements_organization_id_idx").on(table.organizationId),
    foreignKey({
      columns: [table.applicationId, table.organizationId],
      foreignColumns: [applications.id, applications.organizationId],
    }),
    check(
      "soil_temperature_measurements_gps_latitude_range",
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`,
    ),
    check(
      "soil_temperature_measurements_gps_longitude_range",
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`,
    ),
  ],
);

// ============================================
// Relations
// ============================================

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  delivery: one(deliveries, {
    fields: [applications.deliveryId],
    references: [deliveries.id],
  }),
  soilTemperatureMeasurements: many(soilTemperatureMeasurements),
}));

export const soilTemperatureMeasurementsRelations = relations(soilTemperatureMeasurements, ({ one }) => ({
  application: one(applications, {
    fields: [soilTemperatureMeasurements.applicationId],
    references: [applications.id],
  }),
}));

// ============================================
// Type Exports
// ============================================

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type SoilTemperatureMeasurement = typeof soilTemperatureMeasurements.$inferSelect;
export type NewSoilTemperatureMeasurement = typeof soilTemperatureMeasurements.$inferInsert;
