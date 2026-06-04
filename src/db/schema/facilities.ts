import { relations, sql } from 'drizzle-orm';
import { check, doublePrecision, pgTable, text, timestamp, uuid, real, jsonb } from 'drizzle-orm/pg-core';
import { storageLocationType, durabilityOption, samplingMethod } from './common';

// ============================================
// Facilities - Production sites
// ============================================

export const facilities = pgTable(
  'facilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    location: text('location'),
    gpsLatitude: doublePrecision('gps_latitude'),
    gpsLongitude: doublePrecision('gps_longitude'),
    timezone: text('timezone'),
    country: text('country').notNull().default('UNKNOWN'),
    address: text('address'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    defaultDurabilityOption: durabilityOption('default_durability_option')
      .notNull()
      .default('200_year'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'facilities_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'facilities_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
  ]
);

// ============================================
// Reactors - Pyrolysis equipment
// ============================================

export const reactors = pgTable('reactors', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // e.g., "R-001"
  identifier: text('identifier').notNull(),
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id),
  // Isometric Protocol: Reactor design requirements (Section 9.2)
  reactorType: text('reactor_type').notNull(), // fixed-bed, auger, rotary-kiln
  samplingMethod: samplingMethod('sampling_method').notNull().default('method_a'),
  nominalThroughputTph: real('nominal_throughput_tph'),
  specifications: jsonb('specifications'), // { description, manufacturer, ... }
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Storage Locations - Bins/piles for materials
// ============================================

export const storageLocations = pgTable(
  'storage_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(), // e.g., "Bin 7", "Feedstock Pile 002"
    type: storageLocationType('type').notNull(),
    capacityKg: real('capacity_kg'),
    storageMethod: text('storage_method'),
    storageDescription: text('storage_description'),
    supplierReferenceId: text('supplier_reference_id'),
    // Enforces "one feedstock type per bin" — set on first intake, validated on subsequent
    // No FK reference to avoid circular import with feedstock.ts; enforced at application layer
    feedstockTypeId: uuid('feedstock_type_id'),
    // Product bins only: enforces "one formulation per bin" so product bins stay clean.
    // NULL = a pure-biochar bin (or not yet claimed). Set at setup or on first product
    // intake, validated on subsequent. No FK reference to avoid a circular import with
    // products.ts; enforced at the application layer (mirrors feedstockTypeId above).
    formulationId: uuid('formulation_id'),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
);

// ============================================
// Relations
// ============================================

export const facilitiesRelations = relations(facilities, ({ many }) => ({
  reactors: many(reactors),
  storageLocations: many(storageLocations),
}));

export const reactorsRelations = relations(reactors, ({ one }) => ({
  facility: one(facilities, {
    fields: [reactors.facilityId],
    references: [facilities.id],
  }),
}));

export const storageLocationsRelations = relations(
  storageLocations,
  ({ one }) => ({
    facility: one(facilities, {
      fields: [storageLocations.facilityId],
      references: [facilities.id],
    }),
  })
);

// ============================================
// Type Inference
// ============================================

export type Facility = typeof facilities.$inferSelect;
export type NewFacility = typeof facilities.$inferInsert;
export type Reactor = typeof reactors.$inferSelect;
export type NewReactor = typeof reactors.$inferInsert;
export type StorageLocation = typeof storageLocations.$inferSelect;
export type NewStorageLocation = typeof storageLocations.$inferInsert;
