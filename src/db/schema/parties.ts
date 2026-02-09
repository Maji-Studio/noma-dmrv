import { pgTable, text, timestamp, uuid, real } from 'drizzle-orm/pg-core';

// ============================================
// Suppliers - Biomass/feedstock suppliers
// ============================================

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  location: text('location'),
  gpsLat: real('gps_lat'),
  gpsLng: real('gps_lng'),
  // CSV schema parity aliases
  gpsLatitude: real('gps_latitude').notNull().default(0),
  gpsLongitude: real('gps_longitude').notNull().default(0),
  address: text('address'),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  annualRevenueUsd: real('annual_revenue_usd'),
  chainOfCustodyRef: text('chain_of_custody_ref'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Customers - Biochar product buyers/farmers
// ============================================

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  location: text('location'),
  gpsLat: real('gps_lat').notNull(),
  gpsLng: real('gps_lng').notNull(),
  gpsLatitude: real('gps_latitude').notNull().default(0),
  gpsLongitude: real('gps_longitude').notNull().default(0),
  distanceKm: real('distance_km'), // Distance from facility
  cropType: text('crop_type'), // e.g., "Coffee"
  address: text('address'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Drivers - Transport drivers
// ============================================

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  contact: text('contact'), // Phone number
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
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  credentials: text('credentials'),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
