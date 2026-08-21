import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './auth';
import {
  deliveryStatus,
  distanceSource,
  emissionsCalculationMethod,
  packagingType,
  transportEntityType,
  transportMethod,
  transportTripType,
} from './common';
import { facilities, storageLocations } from './facilities';
import { massKg, percent } from './numeric-families';
import { customerLocations, customers, drivers } from './parties';
import { biocharProducts } from './products';
import { biocharStorageInventory } from './storage-inventory';

// ============================================
// Vehicles - Transport vehicles with fuel configuration
// ============================================

export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(), // e.g., "Truck 1", "Truck 2", "Truck 3"
  // Operational/audit metadata — not consumed by the certified transport calc
  // (distance-based, Eq. 3). Optional so a vehicle can be recorded with just a
  // name + type. See vehicleType note below.
  identifier: text('identifier'),
  // Required: selects the Isometric component emission factor (Eq. 3); the only
  // vehicle field the certified transport calc actually depends on.
  vehicleType: text('vehicle_type').notNull(), // e.g., "truck", "tractor"
  fuelType: text('fuel_type'), // e.g., "Diesel" — metadata only
  fuelConsumptionLPerKm: real('fuel_consumption_l_per_km'), // e.g., 0.3 L/km — metadata only, never submitted
  modelYear: integer('model_year'), // factor-uniformity hedge, not submitted
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('vehicles_organization_id_code_unique').on(table.organizationId, table.code),
  unique('vehicles_organization_id_name_unique').on(table.organizationId, table.name),
]);

// ============================================
// Orders - Customer orders for biochar products
// ============================================

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  code: text('code').notNull(), // e.g., "OR-2025-043"
  facilityId: uuid('facility_id')
    .notNull(),
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

  // Stamped by the facility archive cascade; NULL = active
  archivedAt: timestamp('archived_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('orders_organization_id_code_unique').on(table.organizationId, table.code),
  unique('orders_id_organization_id_unique').on(table.id, table.organizationId),
  foreignKey({
    columns: [table.facilityId, table.organizationId],
    foreignColumns: [facilities.id, facilities.organizationId],
  }),
]);

// ============================================
// Deliveries - Delivery of biochar products
// Isometric Protocol: Transport emissions now sourced from transport_legs
// ============================================

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(), // e.g., "DL-2025-043"
    facilityId: uuid('facility_id')
      .notNull(),
    deliveryDate: timestamp('delivery_date').notNull(),
    status: deliveryStatus('status').default('upcoming').notNull(),

    // --- Linked Order ---
    orderId: uuid('order_id')
      .notNull(),

    // Optional override when delivery destination differs from order destination.
    customerLocationId: uuid('customer_location_id').references(
      () => customerLocations.id
    ),

    // Per-delivery road-distance override (km) for the distribution transport
    // leg. Defaults to the destination customer location's distance; set here
    // only when this trip's routing differs. Mirrors the feedstock-side
    // transportDistanceKm override.
    distanceKmOverride: real('distance_km_override'),
    // Provenance of the effective trip distance. Usually null when no distance
    // override is stored; `document` may be persisted alone when this delivery
    // has trip-specific evidence for the inherited customer-location distance.
    distanceSource: distanceSource('distance_source'),
    distanceNote: text('distance_note'),
    // Return-vs-one-way evidence metadata for the distribution transport leg.
    // Noma submits the entered distance once to Isometric for either value.
    tripType: transportTripType('trip_type').notNull().default('return'),

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
    moistureContentPercent: percent('moisture_content_percent'),
    deliveredWetMassKg: massKg('delivered_wet_mass_kg'),
    // Server-authoritative dry biochar allocated from the linked product.
    massDryKg: massKg('mass_dry_kg'),

    // Independent delivery-site observations required by Isometric's
    // Biochar Application API. Their difference is evidence, not a substitute
    // for the separately recorded delivered wet mass.
    truckMassOnArrivalKg: massKg('truck_mass_on_arrival_kg'),
    truckMassOnDepartureKg: massKg('truck_mass_on_departure_kg'),

    // --- Operational transport (emissions canonical in transport_legs) ---
    driverId: uuid('driver_id').references(() => drivers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),

    // Stamped by the facility archive cascade; NULL = active
    archivedAt: timestamp('archived_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('deliveries_organization_id_code_unique').on(table.organizationId, table.code),
    unique('deliveries_id_organization_id_unique').on(table.id, table.organizationId),
    index('deliveries_organization_id_order_id_delivery_date_idx').on(
      table.organizationId,
      table.orderId,
      table.deliveryDate
    ),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    foreignKey({
      columns: [table.orderId, table.organizationId],
      foreignColumns: [orders.id, orders.organizationId],
    }),
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
    check(
      'deliveries_distance_km_override_non_negative',
      sql`${table.distanceKmOverride} is null or ${table.distanceKmOverride} >= 0`
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),

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
    // Provenance of distanceKm. On a derived leg this is inherited from the
    // level that won the distance-priority resolution (NOT a blanket
    // supplier/customer default); on an aggregated distribution leg it is the
    // weakest contributing source. Orthogonal to isDerived.
    distanceSource: distanceSource('distance_source'),

    // --- Transport Details ---
    transportMethodType: transportMethod('transport_method').notNull(), // road | rail | ship | pipeline | aircraft
    vehicleType: text('vehicle_type'), // e.g., "Class 8 heavy-duty truck" — selects the Isometric component EF (Eq. 3)
    modelYear: integer('model_year'),

    // --- Load Details (Isometric: Distance-Based Method, Eq. 3 — W_j, the cargo mass) ---
    loadMassKg: massKg('load_mass_kg'),

    // Return-vs-one-way evidence metadata. The stored distanceKm is the single
    // entered per-leg distance and is submitted once for either value.
    // Orthogonal to distanceSource / isDerived.
    tripType: transportTripType('trip_type').notNull().default('return'),

    // --- Method (distance-based only — see ADR/changes; the emission factor
    // lives in the Isometric component blueprint, NOT here: we submit distance +
    // mass and Certify computes `distance × Σmass × factor`). ---
    calculationMethodType:
      emissionsCalculationMethod('calculation_method')
        .notNull()
        .default('distance_based'),
    isDerived: boolean('is_derived').notNull().default(false),

    // --- Documentation ---
    billOfLading: text('bill_of_lading'),
    weighScaleTicketRef: text('weigh_scale_ticket_ref'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('transport_legs_organization_id_idx').on(table.organizationId),
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
    // Distance-based accounting (Eq. 3) needs the cargo mass on every leg; the
    // emission factor is supplied by the Isometric component, not stored here.
    check(
      'transport_legs_distance_based_requirements',
      sql`${table.calculationMethodType} <> 'distance_based'::emissions_calculation_method or ${table.loadMassKg} is not null`
    ),
    uniqueIndex('transport_legs_one_derived_per_entity_idx')
      .on(table.entityType, table.entityId)
      .where(sql`${table.isDerived} = true`),
    index('transport_legs_entity_type_entity_id_idx').on(
      table.entityType,
      table.entityId
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
