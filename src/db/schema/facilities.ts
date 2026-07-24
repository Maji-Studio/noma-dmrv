import { relations, sql } from 'drizzle-orm';
import { check, doublePrecision, foreignKey, pgTable, text, timestamp, unique, uniqueIndex, uuid, real, jsonb } from 'drizzle-orm/pg-core';
import { storageLocationType, durabilityOption } from './common';
import { organizations } from './auth';

// ============================================
// Facilities - Production sites
// ============================================

export const facilities = pgTable(
  'facilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    location: text('location'),
    gpsLatitude: doublePrecision('gps_latitude'),
    gpsLongitude: doublePrecision('gps_longitude'),
    timezone: text('timezone').notNull().default('UTC'),
    country: text('country').notNull().default('UNKNOWN'),
    address: text('address'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    // Durability tier is declared once per facility and inherited downward by
    // its credit batches, their samples, and the facility's Isometric removal
    // template (ADR 0021). This is the single source of truth — the former
    // per-batch `credit_batches.durability_option` column is gone; tier is
    // read from the facility (join-derived) wherever a batch needs it.
    // 1000-year is the go-forward tier; 200-year is surfaced-but-disabled in
    // the UI until a 200-year client onboards.
    durabilityOption: durabilityOption('durability_option')
      .notNull()
      .default('1000_year'),

    // Soft-delete: archiving a facility cascades the same stamp to all
    // facility-scoped child tables in one transaction (see data-access/facilities.ts).
    // NULL = active. Reversible via restoreFacility.
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('facilities_organization_id_code_unique').on(table.organizationId, table.code),
    unique('facilities_id_organization_id_unique').on(table.id, table.organizationId),
    // Facility name is unique per organization, case- and whitespace-insensitive
    // (issue #252 pattern, ADR 0010). Two indistinguishable facilities in one
    // org let an operator file records against the wrong site. Archived
    // facilities keep their name reserved so a restore can't collide (mirrors
    // the code-reservation rule).
    uniqueIndex('facilities_organization_id_name_unique').on(
      table.organizationId,
      sql`lower(trim(${table.name}))`,
    ),
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

export const reactors = pgTable(
  'reactors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(), // e.g., "R-001"
    identifier: text('identifier').notNull(),
    facilityId: uuid('facility_id')
      .notNull(),
    // Isometric Protocol: Reactor design requirements (Section 9.2)
    reactorType: text('reactor_type').notNull(), // fixed-bed, auger, rotary-kiln
    // Sampling is not a reactor property; each credit batch stores its own
    // sampled/unsampled choice within a facility/feedstock process (ADR 0022).
    nominalThroughputTph: real('nominal_throughput_tph'),
    specifications: jsonb('specifications'), // { description, manufacturer, ... }
    // Stamped by individual or facility-cascade archive; NULL = active
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('reactors_organization_id_code_unique').on(table.organizationId, table.code),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    // Human identifier is unique per facility, case- and whitespace-insensitive
    // (issue #252) — two indistinguishable reactors in one facility let an
    // operator attach a run to the wrong one. Decommission-and-reuse is handled
    // by renaming the retired reactor; archived rows still hold their identifier
    // so a restore can't collide (mirrors the code-reservation rule).
    uniqueIndex('reactors_facility_identifier_unique').on(
      table.organizationId,
      table.facilityId,
      sql`lower(trim(${table.identifier}))`,
    ),
  ],
);

// ============================================
// Storage Locations - Bins/piles for materials
// ============================================

export const storageLocations = pgTable(
  'storage_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(),
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
      .notNull(),
    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('storage_locations_organization_id_code_unique').on(table.organizationId, table.code),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    check(
      'storage_locations_formulation_product_bin_only',
      sql`${table.type} = 'product_bin' or ${table.formulationId} is null`
    ),
    // Bin name is unique per facility, case- and whitespace-insensitive (issue
    // #252). Archived bins keep their name reserved so a facility restore can't
    // collide (mirrors the code-reservation rule).
    uniqueIndex('storage_locations_facility_name_unique').on(
      table.organizationId,
      table.facilityId,
      sql`lower(trim(${table.name}))`,
    ),
  ],
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
