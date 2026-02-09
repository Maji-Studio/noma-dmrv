import { pgTable, text, timestamp, uuid, real, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { storageLocationType, durabilityOption } from './common';

// ============================================
// Facilities - Production sites
// ============================================

export const facilities = pgTable('facilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  location: text('location'),
  gpsLat: real('gps_lat'),
  gpsLng: real('gps_lng'),
  // CSV schema parity aliases
  gpsLatitude: real('gps_latitude').notNull().default(0),
  gpsLongitude: real('gps_longitude').notNull().default(0),
  country: text('country').notNull().default('UNKNOWN'),
  address: text('address'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  defaultDurabilityOption: durabilityOption('default_durability_option')
    .notNull()
    .default('200_year'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
  designSpecs: text('design_specs'), // JSON or description of design
  specifications: jsonb('specifications'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Storage Locations - Bins/piles for materials
// ============================================

export const storageLocations = pgTable('storage_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(), // e.g., "Bin 7", "Feedstock Pile 002"
  type: storageLocationType('type').notNull(),
  capacityKg: real('capacity_kg'),
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
