import { relations, sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid, real } from 'drizzle-orm/pg-core';
import { feedstockStatus } from './common';
import { facilities, storageLocations } from './facilities';
import { suppliers, drivers } from './parties';
import { vehicles } from './logistics';

// ============================================
// Feedstock Deliveries - Incoming biomass shipments
// Tracks transport details separately from feedstock material info
// ============================================

export const feedstockDeliveries = pgTable(
  'feedstock_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "FD-2025-001"
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    status: feedstockStatus('status').default('missing_data').notNull(),

    // --- Delivery Details ---
    deliveryDate: timestamp('delivery_date').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    driverId: uuid('driver_id').references(() => drivers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    gpsLatitude: real('gps_latitude'),
    gpsLongitude: real('gps_longitude'),

    // --- Feedstock Details ---
    feedstockTypeId: uuid('feedstock_type_id').references(
      () => feedstockTypes.id
    ),
    storageLocationId: uuid('storage_location_id').references(
      () => storageLocations.id
    ),
    wetMassKg: real('wet_mass_kg'),
    moisturePercent: real('moisture_percent'),

    // --- Documentation ---
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
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

export const feedstockTypes = pgTable('feedstock_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull().unique(), // e.g., "Mixed Wood Chips", "Hardwood"
  category: text('category').notNull(), // forestry | agricultural | industrial | municipal | invasive
  description: text('description'),
  registryUrl: text('registry_url'), // Link to Isometric registry page

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Feedstocks - Incoming biomass batches
// Isometric Protocol: Biomass Feedstock Accounting Module
// ============================================

export const feedstocks = pgTable(
  'feedstocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "FS-2025-001"
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    status: feedstockStatus('status').default('missing_data').notNull(),

    // --- Delivery Reference ---
    // Transport details (driver, vehicle, fuel, distance, emissions) live on feedstockDeliveries
    feedstockDeliveryId: uuid('feedstock_delivery_id')
      .notNull()
      .references(() => feedstockDeliveries.id),

    // --- Feedstock Details ---
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),
    massWetKg: real('mass_wet_kg'), // Nullable: moisture changes over time in bins
    massDryKg: real('mass_dry_kg').notNull(),
    moistureContentPercent: real('moisture_content_percent'),
    co2eFeedstockTons: real('co2e_feedstock_tons'),
    feedstockSourceRegion: text('feedstock_source_region'),
    storageLocationId: uuid('storage_location_id').references(
      () => storageLocations.id
    ),

    // --- Counterfactual & Leakage (Isometric §3–4) ---
    counterfactualCategory: text('counterfactual_category'),
    counterfactualEmissions15Tons: real('counterfactual_emissions_15_tons'),
    counterfactualStorage50Tons: real('counterfactual_storage_50_tons'),
    marketLeakageMethod: text('market_leakage_method'),
    marketLeakageTons: real('market_leakage_tons'),
    baselineScenario: text('baseline_scenario').notNull().default('unknown'),
    baselineDescription: text('baseline_description').notNull().default(''),

    // --- Documentation ---
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
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
    driver: one(drivers, {
      fields: [feedstockDeliveries.driverId],
      references: [drivers.id],
    }),
    vehicle: one(vehicles, {
      fields: [feedstockDeliveries.vehicleId],
      references: [vehicles.id],
    }),
    feedstockType: one(feedstockTypes, {
      fields: [feedstockDeliveries.feedstockTypeId],
      references: [feedstockTypes.id],
    }),
    storageLocation: one(storageLocations, {
      fields: [feedstockDeliveries.storageLocationId],
      references: [storageLocations.id],
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
  feedstockDelivery: one(feedstockDeliveries, {
    fields: [feedstocks.feedstockDeliveryId],
    references: [feedstockDeliveries.id],
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
