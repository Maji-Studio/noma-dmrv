import { relations, sql } from 'drizzle-orm';
import { check, doublePrecision, foreignKey, pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';
import { feedstockEligibilityStatus, feedstockStatus, feedstockTypeUsage } from './common';
import { massKg, percent, tonnes } from './numeric-families';
import { facilities, storageLocations } from './facilities';
import { suppliers } from './parties';
import { vehicles } from './logistics';
import type { InferSelectModel } from 'drizzle-orm';
import { organizations } from './auth';

// ============================================
// Feedstock Deliveries - Incoming biomass shipments
// Tracks transport details separately from feedstock material info
// ============================================

export const feedstockDeliveries = pgTable(
  'feedstock_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(), // e.g., "FD-2025-001"
    facilityId: uuid('facility_id')
      .notNull(),
    status: feedstockStatus('status').default('missing_data').notNull(),

    // --- Delivery Details ---
    deliveryDate: timestamp('delivery_date').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    gpsLatitude: doublePrecision('gps_latitude'),
    gpsLongitude: doublePrecision('gps_longitude'),

    // --- Feedstock Details ---
    feedstockTypeId: uuid('feedstock_type_id').references(
      () => feedstockTypes.id
    ),
    wetMassKg: massKg('wet_mass_kg'),
    moisturePercent: percent('moisture_percent'),

    // --- Documentation ---
    notes: text('notes'),

    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('feedstock_deliveries_organization_id_code_unique').on(table.organizationId, table.code),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    check(
      'feedstock_deliveries_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'feedstock_deliveries_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
  ]
);

// ============================================
// Feedstock Types - Biomass classification
// ============================================

export const feedstockTypes = pgTable(
  'feedstock_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(),
    name: text('name').notNull(), // e.g., "Mixed Wood Chips", "Hardwood"
    category: text('category').notNull(), // forestry | agricultural | industrial | municipal | invasive
    usage: feedstockTypeUsage('usage').notNull().default('pyrolysis'),
    description: text('description'),
    registryUrl: text('registry_url'), // Link to Isometric registry page

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('feedstock_types_organization_id_code_unique').on(table.organizationId, table.code),
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
    code: text('code').notNull(), // e.g., "FI-2025-001"
    facilityId: uuid('facility_id')
      .notNull(),
    status: feedstockStatus('status').default('missing_data').notNull(),

    // --- Delivery Reference (nullable for migration; will be dropped in Phase 2) ---
    feedstockDeliveryId: uuid('feedstock_delivery_id')
      .references(() => feedstockDeliveries.id),

    // --- Delivery Details (absorbed from feedstock_deliveries) ---
    deliveryDate: timestamp('delivery_date'),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    gpsLatitude: doublePrecision('gps_latitude'),
    gpsLongitude: doublePrecision('gps_longitude'),

    // --- Delivery Grouping (for split deliveries: one truck → multiple bins) ---
    deliveryGroupId: uuid('delivery_group_id'),

    // --- Override ---
    overrideJustification: text('override_justification'),

    // --- Feedstock Details ---
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),
    massWetKg: massKg('mass_wet_kg'), // Nullable: moisture changes over time in bins
    massDryKg: massKg('mass_dry_kg').notNull(),
    moistureContentPercent: percent('moisture_content_percent'),
    co2eFeedstockTons: tonnes('co2e_feedstock_tons'),
    feedstockSourceRegion: text('feedstock_source_region'),
    storageLocationId: uuid('storage_location_id').references(
      () => storageLocations.id
    ),

    // --- Counterfactual & Leakage (Isometric §3–4) ---
    counterfactualCategory: text('counterfactual_category'),
    counterfactualEmissions15Tons: tonnes('counterfactual_emissions_15_tons'),
    counterfactualStorage50Tons: tonnes('counterfactual_storage_50_tons'),
    marketLeakageMethod: text('market_leakage_method'),
    marketLeakageTons: tonnes('market_leakage_tons'),
    baselineScenario: text('baseline_scenario').notNull().default('unknown'),
    baselineDescription: text('baseline_description').notNull().default(''),

    // --- Isometric: Biomass eligibility (Feedstock Accounting Module — >25% ineligible cap) ---
    eligibilityStatus: feedstockEligibilityStatus('eligibility_status'),

    // --- Documentation ---
    notes: text('notes'),

    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
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
      sql`${table.massWetKg} is null or ${table.massDryKg} <= ${table.massWetKg}`
    ),
    check(
      'feedstocks_moisture_content_percent_range',
      sql`${table.moistureContentPercent} is null or (${table.moistureContentPercent} >= 0 and ${table.moistureContentPercent} <= 100)`
    ),
    check(
      'feedstocks_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'feedstocks_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
  ]
);

// ============================================
// Relations
// ============================================

export const feedstockDeliveriesRelations = relations(
  feedstockDeliveries,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [feedstockDeliveries.facilityId],
      references: [facilities.id],
    }),
    supplier: one(suppliers, {
      fields: [feedstockDeliveries.supplierId],
      references: [suppliers.id],
    }),
    vehicle: one(vehicles, {
      fields: [feedstockDeliveries.vehicleId],
      references: [vehicles.id],
    }),
    feedstockType: one(feedstockTypes, {
      fields: [feedstockDeliveries.feedstockTypeId],
      references: [feedstockTypes.id],
    }),
    feedstocks: many(feedstocks),
  })
);

export const feedstockTypesRelations = relations(feedstockTypes, ({ many }) => ({
  feedstocks: many(feedstocks),
  feedstockDeliveries: many(feedstockDeliveries),
}));

export const feedstocksRelations = relations(feedstocks, ({ one }) => ({
  facility: one(facilities, {
    fields: [feedstocks.facilityId],
    references: [facilities.id],
  }),
  // Legacy relation — will be removed in Phase 2
  feedstockDelivery: one(feedstockDeliveries, {
    fields: [feedstocks.feedstockDeliveryId],
    references: [feedstockDeliveries.id],
  }),
  // Delivery relations (absorbed from feedstock_deliveries)
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

export type FeedstockDelivery = InferSelectModel<typeof feedstockDeliveries>;
export type FeedstockType = InferSelectModel<typeof feedstockTypes>;
export type Feedstock = InferSelectModel<typeof feedstocks>;
