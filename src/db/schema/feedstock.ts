import { relations, sql } from 'drizzle-orm';
import { check, real, integer, foreignKey, pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';
import { distanceSource, FEEDSTOCK_CATEGORIES, feedstockStatus, feedstockTypeUsage } from './common';
import { massKg, percent } from './numeric-families';
import { facilities, storageLocations } from './facilities';
import { suppliers } from './parties';
import { vehicles } from './logistics';
import type { InferSelectModel } from 'drizzle-orm';
import { organizations } from './auth';

// ============================================
// Feedstock Types - Biomass classification
// ============================================

export const feedstockTypes = pgTable(
  'feedstock_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull().default(1),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(),
    name: text('name').notNull(), // e.g., "Mixed Wood Chips", "Hardwood"
    category: text('category', { enum: FEEDSTOCK_CATEGORIES }).notNull(),
    usage: feedstockTypeUsage('usage').notNull(),
    description: text('description'),
    registryUrl: text('registry_url'), // Optional external registry page URL
    isometricFeedstockTypeId: text('isometric_feedstock_type_id'),
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check('feedstock_types_category_valid', sql`${table.category} in (${sql.join(
      FEEDSTOCK_CATEGORIES.map((category) => sql.raw(`'${category}'`)), sql`, `,
    )})`),
    unique('feedstock_types_organization_id_code_unique').on(table.organizationId, table.code),
    unique('feedstock_types_organization_id_isometric_id_unique').on(
      table.organizationId,
      table.isometricFeedstockTypeId
    ),
    unique('feedstock_types_organization_id_name_usage_unique').on(
      table.organizationId,
      table.name,
      table.usage
    ),
  ]
);

// ============================================
// Feedstocks - Incoming biomass batches
// Isometric Protocol: Biomass Feedstock Accounting Module
// ============================================

export const feedstocks = pgTable(
  'feedstocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    version: integer('version').notNull().default(1),
    code: text('code').notNull(), // e.g., "FI-2025-001"
    facilityId: uuid('facility_id')
      .notNull(),
    status: feedstockStatus('status').default('missing_data').notNull(),

    // --- Delivery Details ---
    deliveryDate: timestamp('delivery_date').notNull(),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),

    // --- Delivery Grouping (for split deliveries: one truck → multiple bins) ---
    deliveryGroupId: uuid('delivery_group_id'),

    // --- Override ---
    overrideJustification: text('override_justification'),
    distanceKmOverride: real('distance_km_override'),
    distanceSource: distanceSource('distance_source'),
    distanceNote: text('distance_note'),

    // --- Feedstock Details ---
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),
    massWetKg: massKg('mass_wet_kg').notNull(),
    massDryKg: massKg('mass_dry_kg').notNull(),
    moistureContentPercent: percent('moisture_content_percent').notNull(),
    storageLocationId: uuid('storage_location_id').notNull().references(
      () => storageLocations.id
    ),

    // Eligibility evidence is maintained outside noma (#942 q8).
    // BFA v1.2.3 Appendix 3 gives FSC Mix and Controlled Wood sourcing
    // recommendations, not a general ineligible-biomass cap.

    // --- Documentation ---
    notes: text('notes'),

    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check('feedstocks_distance_override_positive', sql`${table.distanceKmOverride} is null or ${table.distanceKmOverride} > 0`),
    unique('feedstocks_organization_id_code_unique').on(table.organizationId, table.code),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    check(
      'feedstocks_mass_dry_non_negative',
      sql`${table.massDryKg} >= 0`
    ),
    check(
      'feedstocks_mass_dry_lte_wet',
      sql`${table.massDryKg} <= ${table.massWetKg}`
    ),
    check(
      'feedstocks_moisture_content_percent_range',
      sql`(${table.moistureContentPercent} >= 0 and ${table.moistureContentPercent} < 100)`
    ),
  ]
);

// ============================================
// Relations
// ============================================

export const feedstockTypesRelations = relations(feedstockTypes, ({ many }) => ({
  feedstocks: many(feedstocks),
}));

export const feedstocksRelations = relations(feedstocks, ({ one }) => ({
  facility: one(facilities, {
    fields: [feedstocks.facilityId],
    references: [facilities.id],
  }),
  // Delivery relations
  supplier: one(suppliers, {
    fields: [feedstocks.supplierId],
    references: [suppliers.id],
  }),
  vehicle: one(vehicles, {
    fields: [feedstocks.vehicleId],
    references: [vehicles.id],
  }),
  feedstockType: one(feedstockTypes, {
    fields: [feedstocks.feedstockTypeId],
    references: [feedstockTypes.id],
  }),
  storageLocation: one(storageLocations, {
    fields: [feedstocks.storageLocationId],
    references: [storageLocations.id],
  }),
}));

// ============================================
// Type Inference
// ============================================

export type FeedstockType = InferSelectModel<typeof feedstockTypes>;
export type Feedstock = InferSelectModel<typeof feedstocks>;
