import { relations, sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  deliveryStatus,
  emissionsCalculationMethod,
  packagingType,
  transportEntityType,
  transportMethod,
} from './common';
import { facilities, storageLocations } from './facilities';
import { customerLocations, customers, drivers } from './parties';
import { biocharProducts } from './products';
import { biocharStorageInventory } from './storage-inventory';

// ============================================
// Vehicles - Transport vehicles with fuel configuration
// ============================================

export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull().unique(), // e.g., "Truck 1", "Truck 2", "Truck 3"
  identifier: text('identifier').notNull(),
  vehicleType: text('vehicle_type').notNull(), // e.g., "truck", "tractor"
  fuelType: text('fuel_type').notNull(), // e.g., "Diesel"
  fuelConsumptionLPerKm: real('fuel_consumption_l_per_km').notNull(), // e.g., 0.3 L/km
  modelYear: integer('model_year').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Orders - Customer orders for biochar products
// ============================================

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // e.g., "OR-2025-043"
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id),
  orderDate: timestamp('order_date').notNull(),

  // --- Customer Details ---
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  customerLocationId: uuid('customer_location_id')
    .references(() => customerLocations.id),
  // --- Order Details ---
  biocharProductId: uuid('biochar_product_id')
    .notNull()
    .references(() => biocharProducts.id),
  quantityKg: real('quantity_kg').notNull(),
  packaging: packagingType('packaging').notNull(),
  value: real('value'),
  currency: text('currency').notNull().default('TZS'), // ISO 4217 code

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Deliveries - Delivery of biochar products
// Isometric Protocol: Transport emissions now sourced from transport_legs
// ============================================

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "DL-2025-043"
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id),
    deliveryDate: timestamp('delivery_date').notNull(),
    status: deliveryStatus('status').default('upcoming').notNull(),

    // --- Linked Order ---
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),

    // Optional override when delivery destination differs from order destination.
    customerLocationId: uuid('customer_location_id').references(
      () => customerLocations.id
    ),

    // --- Product Batch ---
    biocharProductId: uuid('biochar_product_id').references(
      () => biocharProducts.id
    ),
    storageLocationId: uuid('storage_location_id').references(
      () => storageLocations.id
    ),
    // Specific product-in-bin record this delivery draws from.
    // Drives quantityKgRemaining decrement and expiry check at delivery creation.
    biocharStorageInventoryId: uuid('biochar_storage_inventory_id').references(
      () => biocharStorageInventory.id
    ),
    moistureContentPercent: real('moisture_content_percent'),
    deliveredWetMassKg: real('delivered_wet_mass_kg'),
    massDryKg: real('mass_dry_kg'),

    // --- Truck Weighing (Isometric: independent mass verification at delivery site) ---
    truckMassOnArrivalKg: real('truck_mass_on_arrival_kg'),
    truckMassOnDepartureKg: real('truck_mass_on_departure_kg'),

    // --- Operational transport (emissions canonical in transport_legs) ---
    driverId: uuid('driver_id').references(() => drivers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'deliveries_mass_dry_non_negative',
      sql`${table.massDryKg} is null or ${table.massDryKg} >= 0`
    ),
    check(
      'deliveries_delivered_wet_mass_non_negative',
      sql`${table.deliveredWetMassKg} is null or ${table.deliveredWetMassKg} >= 0`
    ),
    check(
      'deliveries_mass_dry_lte_wet_mass',
      sql`${table.massDryKg} is null or ${table.deliveredWetMassKg} is null or ${table.massDryKg} <= ${table.deliveredWetMassKg}`
    ),
    check(
      'deliveries_truck_mass_on_arrival_non_negative',
      sql`${table.truckMassOnArrivalKg} is null or ${table.truckMassOnArrivalKg} >= 0`
    ),
    check(
      'deliveries_truck_mass_on_departure_non_negative',
      sql`${table.truckMassOnDepartureKg} is null or ${table.truckMassOnDepartureKg} >= 0`
    ),
    check(
      'deliveries_truck_mass_arrival_gte_departure',
      sql`${table.truckMassOnArrivalKg} is null or ${table.truckMassOnDepartureKg} is null or ${table.truckMassOnArrivalKg} >= ${table.truckMassOnDepartureKg}`
    ),
  ]
);

// ============================================
// Transport Legs - Canonical transportation emissions tracking
// Isometric: Transportation Emissions Accounting Module v1.1
// ============================================

export const transportLegs = pgTable(
  'transport_legs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Polymorphic reference to the entity being transported.
    entityType: transportEntityType('entity_type').notNull(), // feedstock | biochar | sample | delivery
    entityId: uuid('entity_id').notNull(),

    // --- Route Details ---
    originGpsLatitude: doublePrecision('origin_gps_latitude'),
    originGpsLongitude: doublePrecision('origin_gps_longitude'),
    originName: text('origin_name'),
    destinationGpsLatitude: doublePrecision('destination_gps_latitude'),
    destinationGpsLongitude: doublePrecision('destination_gps_longitude'),
    destinationName: text('destination_name'),
    distanceKm: real('distance_km').notNull(),

    // --- Transport Details ---
    transportMethodType: transportMethod('transport_method').notNull(), // road | rail | ship | pipeline | aircraft
    vehicleType: text('vehicle_type'), // e.g., "Class 8 heavy-duty truck"
    modelYear: integer('model_year'),

    // --- Fuel/Energy Details (Isometric: Energy Usage Method - preferred) ---
    fuelType: text('fuel_type'), // diesel, biodiesel, gasoline, electricity, etc.
    fuelConsumedLiters: real('fuel_consumed_liters'),
    electricityKwh: real('electricity_kwh'),

    // --- Load Details (Isometric: Distance-Based Method) ---
    loadMassKg: real('load_mass_kg'),

    // --- Emissions Calculation (Isometric: Section 3) ---
    calculationMethodType:
      emissionsCalculationMethod('calculation_method').notNull(), // energy_usage | distance_based
    emissionFactorUsed: real('emission_factor_used'),
    emissionFactorSource: text('emission_factor_source'), // Citation for emission factor
    transportEmissionsCo2eKg: real('transport_emissions_co2e_kg'),

    // --- Documentation ---
    billOfLading: text('bill_of_lading'),
    weighScaleTicketRef: text('weigh_scale_ticket_ref'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'transport_legs_origin_gps_latitude_range',
      sql`${table.originGpsLatitude} is null or (${table.originGpsLatitude} >= -90 and ${table.originGpsLatitude} <= 90)`
    ),
    check(
      'transport_legs_origin_gps_longitude_range',
      sql`${table.originGpsLongitude} is null or (${table.originGpsLongitude} >= -180 and ${table.originGpsLongitude} <= 180)`
    ),
    check(
      'transport_legs_destination_gps_latitude_range',
      sql`${table.destinationGpsLatitude} is null or (${table.destinationGpsLatitude} >= -90 and ${table.destinationGpsLatitude} <= 90)`
    ),
    check(
      'transport_legs_destination_gps_longitude_range',
      sql`${table.destinationGpsLongitude} is null or (${table.destinationGpsLongitude} >= -180 and ${table.destinationGpsLongitude} <= 180)`
    ),
    check(
      'transport_legs_energy_usage_requirements',
      sql`${table.calculationMethodType} <> 'energy_usage'::emissions_calculation_method or (
        ${table.fuelType} is not null and
        (${table.fuelConsumedLiters} is not null or ${table.electricityKwh} is not null) and
        ${table.emissionFactorUsed} is not null
      )`
    ),
    check(
      'transport_legs_distance_based_requirements',
      sql`${table.calculationMethodType} <> 'distance_based'::emissions_calculation_method or (
        ${table.loadMassKg} is not null and
        ${table.vehicleType} is not null and
        ${table.emissionFactorUsed} is not null
      )`
    ),
  ]
);

// ============================================
// Relations
// ============================================

export const ordersRelations = relations(orders, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [orders.facilityId],
    references: [facilities.id],
  }),
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  customerLocation: one(customerLocations, {
    fields: [orders.customerLocationId],
    references: [customerLocations.id],
  }),
  biocharProduct: one(biocharProducts, {
    fields: [orders.biocharProductId],
    references: [biocharProducts.id],
  }),
  deliveries: many(deliveries),
}));

export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  facility: one(facilities, {
    fields: [deliveries.facilityId],
    references: [facilities.id],
  }),
  order: one(orders, {
    fields: [deliveries.orderId],
    references: [orders.id],
  }),
  customerLocation: one(customerLocations, {
    fields: [deliveries.customerLocationId],
    references: [customerLocations.id],
    relationName: 'deliveryLocationOverride',
  }),
  biocharProduct: one(biocharProducts, {
    fields: [deliveries.biocharProductId],
    references: [biocharProducts.id],
  }),
  storageLocation: one(storageLocations, {
    fields: [deliveries.storageLocationId],
    references: [storageLocations.id],
  }),
  biocharStorageInventory: one(biocharStorageInventory, {
    fields: [deliveries.biocharStorageInventoryId],
    references: [biocharStorageInventory.id],
  }),
  driver: one(drivers, {
    fields: [deliveries.driverId],
    references: [drivers.id],
  }),
  vehicle: one(vehicles, {
    fields: [deliveries.vehicleId],
    references: [vehicles.id],
  }),
}));

// ============================================
// Type Exports
// ============================================

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Delivery = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;
export type TransportLeg = typeof transportLegs.$inferSelect;
export type NewTransportLeg = typeof transportLegs.$inferInsert;
