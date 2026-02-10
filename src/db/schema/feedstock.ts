import { relations, sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid, real, date } from 'drizzle-orm/pg-core';
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
    vehicleDescription: text('vehicle_description'),
    vehicleType: text('vehicle_type'),
    fuelType: text('fuel_type'),
    gpsLatitude: real('gps_latitude'),
    gpsLongitude: real('gps_longitude'),
    distanceKm: real('distance_km'), // Can be auto-calculated or manually entered
    fuelConsumedLiters: real('fuel_consumed_liters'),
    // Isometric: Transport emissions (calculated)
    transportEmissionsTco2e: real('transport_emissions_tco2e'),
    transportEmissionsCo2eKg: real('transport_emissions_co2e_kg'),
    emissionFactorUsed: text('emission_factor_used'),

    // --- Feedstock Details ---
    feedstockTypeId: uuid('feedstock_type_id').references(
      () => feedstockTypes.id
    ),
    weightKg: real('weight_kg'),
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
    date: date('date').notNull(),
    status: feedstockStatus('status').default('missing_data').notNull(),

    // --- Delivery Reference ---
    feedstockDeliveryId: uuid('feedstock_delivery_id').references(
      () => feedstockDeliveries.id
    ),

    // --- Delivery & Transport ---
    collectionDate: timestamp('collection_date'),
    deliveryDate: timestamp('delivery_date').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    driverId: uuid('driver_id').references(() => drivers.id),
    vehicleType: text('vehicle_type'),
    fuelType: text('fuel_type'), // e.g., "Diesel"
    fuelConsumedLiters: real('fuel_consumed_liters'),
    distanceKm: real('distance_km'),
    // Isometric: Transport emissions (calculated)
    transportEmissionsTco2e: real('transport_emissions_tco2e'),

    // --- Feedstock Details ---
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),
    weightKg: real('weight_kg'),
    massWetKg: real('mass_wet_kg').notNull(),
    massDryKg: real('mass_dry_kg').notNull(),
    moisturePercent: real('moisture_percent'),
    moistureContentPercent: real('moisture_content_percent'),
    totalCarbonPercent: real('total_carbon_percent'),
    inorganicCarbonPercent: real('inorganic_carbon_percent'),
    totalOrganicCarbonPercent: real('total_organic_carbon_percent'),
    co2eFeedstockTons: real('co2e_feedstock_tons'),
    feedstockSourceRegion: text('feedstock_source_region'),
    storageLocationId: uuid('storage_location_id').references(
      () => storageLocations.id
    ),
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
      sql`${table.massDryKg} <= ${table.massWetKg}`
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
  supplier: one(suppliers, {
    fields: [feedstocks.supplierId],
    references: [suppliers.id],
  }),
  driver: one(drivers, {
    fields: [feedstocks.driverId],
    references: [drivers.id],
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
