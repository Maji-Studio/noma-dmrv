import { relations, sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid, real } from 'drizzle-orm/pg-core';

// ============================================
// Suppliers - Biomass/feedstock suppliers
// ============================================

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    location: text('location'),
    gpsLatitude: real('gps_latitude'),
    gpsLongitude: real('gps_longitude'),
    address: text('address'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    annualRevenueUsd: real('annual_revenue_usd'),
    chainOfCustodyRef: text('chain_of_custody_ref'),
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
    name: text('name').notNull(),
    gpsLatitude: real('gps_latitude').notNull(),
    gpsLongitude: real('gps_longitude').notNull(),
    address: text('address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'customer_locations_gps_latitude_range',
      sql`${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90`
    ),
    check(
      'customer_locations_gps_longitude_range',
      sql`${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180`
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
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
export type Operator = typeof operators.$inferSelect;
export type NewOperator = typeof operators.$inferInsert;
