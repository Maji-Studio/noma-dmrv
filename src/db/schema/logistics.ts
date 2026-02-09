import { pgTable, text, timestamp, uuid, real, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  orderStatus,
  deliveryStatus,
  packagingType,
  transportEntityType,
  transportMethod,
  emissionsCalculationMethod,
} from './common';
import { facilities, storageLocations } from './facilities';
import { customers, drivers } from './parties';
import { formulations, biocharProducts } from './products';

// ============================================
// Vehicles - Transport vehicles with fuel configuration
// ============================================

export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull().unique(), // e.g., "Truck 1", "Truck 2", "Truck 3"
  identifier: text('identifier').notNull(),
  type: text('type').notNull(),
  vehicleType: text('vehicle_type').notNull(), // e.g., "truck", "tractor"
  fuelType: text('fuel_type').notNull(), // e.g., "Diesel"
  fuelConsumptionLPerKm: real('fuel_consumption_l_per_km').notNull(), // e.g., 0.3 L/km
  fuelConsumptionRate: real('fuel_consumption_rate'),
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
  status: orderStatus('status').default('ordered').notNull(),

  // --- Customer Details ---
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  invoiceNumber: text('invoice_number'), // e.g., "24-0009"

  // --- Order Details ---
  formulationId: uuid('formulation_id').references(() => formulations.id),
  biocharProductId: uuid('biochar_product_id')
    .notNull()
    .references(() => biocharProducts.id),
  quantityTons: real('quantity_tons').notNull(),
  quantityKg: real('quantity_kg').notNull(),
  quantityM3: real('quantity_m3'),
  biocharTons: real('biochar_tons'),
  packaging: packagingType('packaging').notNull(),
  packagingType: text('packaging_type').notNull().default('bagged'),
  valueTzs: real('value_tzs'), // Value in Tanzanian Shillings

  // --- Application Details ---
  applicationStatus: text('application_status'), // e.g., "In preparation"
  bulkDensityKgL: real('bulk_density_kg_l'),
  cSinkType: text('c_sink_type'), // e.g., "Geo localised C Sink"
  compostPerM3Percent: real('compost_per_m3_percent'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Deliveries - Delivery of biochar products
// Isometric Protocol: Transport emissions tracking
// ============================================

export const deliveries = pgTable('deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // e.g., "DL-2025-043"
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id),
  deliveryDate: timestamp('delivery_date').notNull(),
  status: deliveryStatus('status').default('processing').notNull(),

  // --- Linked Order ---
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),

  // --- Product Batch ---
  biocharProductId: uuid('biochar_product_id').references(
    () => biocharProducts.id
  ),
  storageLocationId: uuid('storage_location_id').references(
    () => storageLocations.id
  ),
  quantityTons: real('quantity_tons'),
  quantityM3: real('quantity_m3'),
  biocharTons: real('biochar_tons'),
  fixedCarbonPercent: real('fixed_carbon_percent'),

  // --- Delivery Details (Isometric: Transportation Emissions) ---
  driverId: uuid('driver_id').references(() => drivers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  vehicleDescription: text('vehicle_description'),
  vehicleType: text('vehicle_type'), // e.g., "Truck"
  fuelType: text('fuel_type').notNull(), // e.g., "Diesel"
  fuelConsumedLiters: real('fuel_consumed_liters').notNull(),
  distanceKm: real('distance_km').notNull(),
  // Isometric: Transport emissions (calculated)
  emissionsTco2e: real('emissions_tco2e').notNull(),
  transportEmissionsCo2eKg: real('transport_emissions_co2e_kg'),
  emissionFactorUsed: text('emission_factor_used').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Transport Legs - Transportation emissions tracking
// Isometric: Transportation Emissions Accounting Module v1.1
// Tracks each leg of transport for feedstock, biochar, or samples
// ============================================

export const transportLegs = pgTable('transport_legs', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Polymorphic reference to the entity being transported
  entityType: transportEntityType('entity_type').notNull(), // feedstock | biochar | sample | delivery
  entityId: uuid('entity_id').notNull(),

  // --- Route Details ---
  originLat: real('origin_lat'),
  originLng: real('origin_lng'),
  originLatitude: real('origin_latitude'),
  originLongitude: real('origin_longitude'),
  originName: text('origin_name'),
  destinationLat: real('destination_lat'),
  destinationLng: real('destination_lng'),
  destinationLatitude: real('destination_latitude'),
  destinationLongitude: real('destination_longitude'),
  destinationName: text('destination_name'),
  distanceKm: real('distance_km').notNull(),

  // --- Transport Details ---
  transportMethodType: transportMethod('transport_method'), // road | rail | ship | pipeline | aircraft
  vehicleType: text('vehicle_type'), // e.g., "Class 8 heavy-duty truck"
  vehicleModelYear: text('vehicle_model_year'),
  modelYear: integer('model_year'),

  // --- Fuel/Energy Details (Isometric: Energy Usage Method - preferred) ---
  fuelType: text('fuel_type'), // diesel, biodiesel, gasoline, electricity, etc.
  fuelConsumedLiters: real('fuel_consumed_liters'),
  electricityKwh: real('electricity_kwh'),

  // --- Load Details (Isometric: Distance-Based Method) ---
  loadWeightTonnes: real('load_weight_tonnes'),
  loadMassKg: real('load_mass_kg'),
  loadCapacityUtilizationPercent: real('load_capacity_utilization_percent'),

  // --- Emissions Calculation (Isometric: Section 3) ---
  calculationMethodType: emissionsCalculationMethod('calculation_method'), // energy_usage | distance_based
  emissionFactorUsed: real('emission_factor_used'),
  emissionFactorSource: text('emission_factor_source'), // Citation for emission factor
  emissionsCo2eKg: real('emissions_co2e_kg'),
  transportEmissionsCo2eKg: real('transport_emissions_co2e_kg'),

  // --- Book and Claim Units (Isometric: Section 4) ---
  bcuUsed: real('bcu_used'), // Volume of BCU fuel substitution
  bcuProvider: text('bcu_provider'),
  bcuCertificationRef: text('bcu_certification_ref'),

  // --- Documentation ---
  billOfLading: text('bill_of_lading'),
  weighScaleTicketRef: text('weigh_scale_ticket_ref'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
  formulation: one(formulations, {
    fields: [orders.formulationId],
    references: [formulations.id],
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
  biocharProduct: one(biocharProducts, {
    fields: [deliveries.biocharProductId],
    references: [biocharProducts.id],
  }),
  storageLocation: one(storageLocations, {
    fields: [deliveries.storageLocationId],
    references: [storageLocations.id],
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
