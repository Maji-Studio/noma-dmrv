import { relations, sql } from 'drizzle-orm';
import { check, doublePrecision, index, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';

// ============================================
// Suppliers - Biomass/feedstock suppliers
// ============================================

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    location: text('location'),
    gpsLatitude: doublePrecision('gps_latitude'),
    gpsLongitude: doublePrecision('gps_longitude'),
    address: text('address'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    sourceRegion: text('source_region'),
    // Road distance (km) from this supplier to the delivery facility. Autofills
    // a feedstock transport leg's distance (overridable). Stored, not computed.
    distanceToFacilityKm: real('distance_to_facility_km'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'suppliers_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'suppliers_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
  ]
);

// ============================================
// Customers - Biochar product buyers/farmers
// ============================================

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  cropType: text('crop_type'), // e.g., "Coffee"
  address: text('address'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Customer Locations - Multi-location destinations per customer
// ============================================

export const customerLocations = pgTable(
  'customer_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    name: text('name'),
    country: text('country').notNull().default('UNKNOWN'),
    stateRegion: text('state_region'),
    city: text('city'),
    gpsLatitude: doublePrecision('gps_latitude'),
    gpsLongitude: doublePrecision('gps_longitude'),
    address: text('address'),
    // Road distance (km) from the origin facility to this customer location.
    // Autofills a delivery transport leg's distance (overridable). Stored.
    distanceFromFacilityKm: real('distance_from_facility_km'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'customer_locations_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'customer_locations_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
  ]
);

// ============================================
// Supplier Locations - Multi-location sources per supplier
// ============================================

export const supplierLocations = pgTable(
  'supplier_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    name: text('name'),
    country: text('country').notNull().default('UNKNOWN'),
    stateRegion: text('state_region'),
    city: text('city'),
    gpsLatitude: doublePrecision('gps_latitude'),
    gpsLongitude: doublePrecision('gps_longitude'),
    address: text('address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('supplier_locations_supplier_id_idx').on(table.supplierId),
    check(
      'supplier_locations_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'supplier_locations_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
  ]
);

// ============================================
// Drivers - Transport drivers
// ============================================

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  licenseNumber: text('license_number'),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Operators - Production/reactor operators
// ============================================

export const operators = pgTable('operators', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  credentials: text('credentials'),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  locations: many(supplierLocations),
}));

export const supplierLocationsRelations = relations(
  supplierLocations,
  ({ one }) => ({
    supplier: one(suppliers, {
      fields: [supplierLocations.supplierId],
      references: [suppliers.id],
    }),
  })
);

export const customersRelations = relations(customers, ({ many }) => ({
  locations: many(customerLocations),
}));

export const customerLocationsRelations = relations(
  customerLocations,
  ({ one }) => ({
    customer: one(customers, {
      fields: [customerLocations.customerId],
      references: [customers.id],
    }),
  })
);

// ============================================
// Type Inference
// ============================================

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerLocation = typeof customerLocations.$inferSelect;
export type NewCustomerLocation = typeof customerLocations.$inferInsert;
export type SupplierLocation = typeof supplierLocations.$inferSelect;
export type NewSupplierLocation = typeof supplierLocations.$inferInsert;
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
export type Operator = typeof operators.$inferSelect;
export type NewOperator = typeof operators.$inferInsert;
