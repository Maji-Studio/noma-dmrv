import type { FacilityDistance } from "@/schemas/facility-distances";
import { relations, sql } from 'drizzle-orm';
import { integer, boolean, check, doublePrecision, index, pgTable, real, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';

// ============================================
// Suppliers - Biomass/feedstock suppliers
// ============================================

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull().default(1),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    location: text('location'),
    address: text('address'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    sourceRegion: text('source_region'),
    // Archived parties keep their name and code reserved so a restore can't collide.
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('suppliers_organization_id_code_unique').on(table.organizationId, table.code),
    // Supplier name is unique per organization, case- and whitespace-insensitive
    // (issue #252, ADR 0010). Reuse a retired name by renaming the old record.
    uniqueIndex('suppliers_organization_id_name_unique').on(
      table.organizationId,
      sql`lower(trim(${table.name}))`
    ),
  ]
);

// ============================================
// Customers - Biochar product buyers/farmers
// ============================================

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull().default(1),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    cropType: text('crop_type'), // e.g., "Coffee"
    address: text('address'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    // Archived parties keep their name and code reserved so a restore can't collide.
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('customers_organization_id_code_unique').on(table.organizationId, table.code),
    // Customer name is unique per organization, case- and whitespace-insensitive
    // (issue #252, ADR 0010). Reuse a retired name by renaming the old record.
    uniqueIndex('customers_organization_id_name_unique').on(
      table.organizationId,
      sql`lower(trim(${table.name}))`
    ),
  ]
);

// ============================================
// Customer Locations - Multi-location destinations per customer
// ============================================

export const customerLocations = pgTable(
  'customer_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull().default(1),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    name: text('name').notNull(),
    country: text('country').notNull(),
    stateRegion: text('state_region'),
    city: text('city'),
    gpsLatitude: doublePrecision('gps_latitude').notNull(),
    gpsLongitude: doublePrecision('gps_longitude').notNull(),
    address: text('address'),
    // Conservative default for the Isometric 200-year soil durability equation.
    // New applications can prefill from this site value while staying editable.
    defaultSoilTemperatureC: real('default_soil_temperature_c'),
    // Marks the customer's primary destination. At most one per customer
    // (enforced by the partial unique index below).
    isDefault: boolean('is_default').notNull().default(false),
    // Archived locations leave the order destination picker and cannot be a
    // new order destination; existing orders, deliveries and storage-site
    // registrations keep them.
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('customer_locations_organization_id_idx').on(table.organizationId),
    index('customer_locations_customer_id_idx').on(table.customerId),
    unique('customer_locations_id_organization_id_unique').on(
      table.id,
      table.organizationId
    ),
    // One default location per customer (partial — only default rows are unique).
    uniqueIndex('customer_locations_one_default_per_customer')
      .on(table.customerId)
      .where(sql`${table.isDefault} = true`),
    check(
      'customer_locations_gps_latitude_range',
      sql`${table.gpsLatitude} is null or (${table.gpsLatitude} >= -90 and ${table.gpsLatitude} <= 90)`
    ),
    check(
      'customer_locations_gps_longitude_range',
      sql`${table.gpsLongitude} is null or (${table.gpsLongitude} >= -180 and ${table.gpsLongitude} <= 180)`
    ),
    check(
      'customer_locations_default_soil_temperature_c_range',
      sql`${table.defaultSoilTemperatureC} is null or (${table.defaultSoilTemperatureC} >= -50 and ${table.defaultSoilTemperatureC} <= 60)`
    ),
    // Backstop for archive: the default location is always an active one.
    check(
      'customer_locations_default_active',
      sql`not ${table.isDefault} or ${table.archivedAt} is null`
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
    version: integer('version').notNull().default(1),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    name: text('name'),
    country: text('country').notNull(),
    stateRegion: text('state_region'),
    city: text('city'),
    gpsLatitude: doublePrecision('gps_latitude').notNull(),
    gpsLongitude: doublePrecision('gps_longitude').notNull(),
    address: text('address'),
    // Marks the supplier's primary source. At most one per supplier
    // (enforced by the partial unique index below).
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('supplier_locations_id_organization_id_unique').on(table.id, table.organizationId),
    index('supplier_locations_organization_id_idx').on(table.organizationId),
    index('supplier_locations_supplier_id_idx').on(table.supplierId),
    // One default location per supplier (partial — only default rows are unique).
    uniqueIndex('supplier_locations_one_default_per_supplier')
      .on(table.supplierId)
      .where(sql`${table.isDefault} = true`),
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
  version: integer('version').notNull().default(1),
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  licenseNumber: text('license_number'),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('drivers_organization_id_code_unique').on(table.organizationId, table.code),
]);

// ============================================
// Operators - Production/reactor operators
// ============================================

export const operators = pgTable('operators', {
  version: integer('version').notNull().default(1),
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  credentials: text('credentials'),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('operators_organization_id_idx').on(table.organizationId),
]);

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
export type CustomerLocation = typeof customerLocations.$inferSelect & { facilityDistances: FacilityDistance[] };
export type NewCustomerLocation = typeof customerLocations.$inferInsert;
export type SupplierLocation = typeof supplierLocations.$inferSelect & { facilityDistances: FacilityDistance[] };
export type NewSupplierLocation = typeof supplierLocations.$inferInsert;
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
export type Operator = typeof operators.$inferSelect;
export type NewOperator = typeof operators.$inferInsert;
