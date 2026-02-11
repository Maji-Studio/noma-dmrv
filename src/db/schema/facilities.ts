import { relations, sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid, real, jsonb } from 'drizzle-orm/pg-core';
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
    gpsLatitude: real('gps_latitude'),
    gpsLongitude: real('gps_longitude'),
    country: text('country').notNull().default('UNKNOWN'),
    address: text('address'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    defaultDurabilityOption: durabilityOption('default_durability_option')
      .notNull()
      .default('200_year'),
    defaultSamplingMethod: samplingMethod('default_sampling_method')
      .notNull()
      .default('method_a'),

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
  type: text('type').notNull(),
  capacityKg: real('capacity_kg'),
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
    latitude: real('latitude'),
    longitude: real('longitude'),
    storageMethod: text('storage_method'),
    storageDescription: text('storage_description'),
    supplierReferenceId: text('supplier_reference_id'),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'storage_locations_latitude_range',
      sql`${table.latitude} is null or (${table.latitude} >= -90 and ${table.latitude} <= 90)`
    ),
    check(
      'storage_locations_longitude_range',
      sql`${table.longitude} is null or (${table.longitude} >= -180 and ${table.longitude} <= 180)`
    ),
  ]
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
