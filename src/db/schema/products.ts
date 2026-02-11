import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  real,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { biocharProductStatus } from './common';
import { facilities, storageLocations } from './facilities';
import { productionRuns } from './production';

// ============================================
// Formulations - Product recipes
// ============================================

export const formulations = pgTable(
  'formulations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "BCF-01"
    name: text('name').notNull(), // e.g., "Raw Biochar", "BCF-01 - Organic"
    biocharRatio: real('biochar_ratio'), // Ratio in [0, 1]
    compostRatio: real('compost_ratio'), // Ratio in [0, 1]
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'formulations_biochar_ratio_range',
      sql`${table.biocharRatio} is null or (${table.biocharRatio} >= 0 and ${table.biocharRatio} <= 1)`
    ),
    check(
      'formulations_compost_ratio_range',
      sql`${table.compostRatio} is null or (${table.compostRatio} >= 0 and ${table.compostRatio} <= 1)`
    ),
  ]
);

// ============================================
// Biochar Products - Finished product batches
// ============================================

export const biocharProducts = pgTable('biochar_products', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // e.g., "BP-2025-043"
  facilityId: uuid('facility_id')
    .notNull()
    .references(() => facilities.id),
  productionDate: timestamp('production_date').defaultNow().notNull(),
  status: biocharProductStatus('status').default('testing').notNull(),

  // --- Composition ---
  formulationId: uuid('formulation_id')
    .notNull()
    .references(() => formulations.id),
  linkedProductionRunId: uuid('linked_production_run_id').references(
    () => productionRuns.id
  ),
  composition: jsonb('composition').notNull().default(sql`'{}'::jsonb`),

  // --- Measurements ---
  massKg: real('mass_kg'),
  densityKgM3: real('density_kg_m3'),

  // --- Location ---
  storageLocationId: uuid('storage_location_id').references(
    () => storageLocations.id
  ),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Relations
// ============================================

export const formulationsRelations = relations(formulations, ({ many }) => ({
  biocharProducts: many(biocharProducts),
}));

export const biocharProductsRelations = relations(
  biocharProducts,
  ({ one }) => ({
    facility: one(facilities, {
      fields: [biocharProducts.facilityId],
      references: [facilities.id],
    }),
    formulation: one(formulations, {
      fields: [biocharProducts.formulationId],
      references: [formulations.id],
    }),
    linkedProductionRun: one(productionRuns, {
      fields: [biocharProducts.linkedProductionRunId],
      references: [productionRuns.id],
    }),
    storageLocation: one(storageLocations, {
      fields: [biocharProducts.storageLocationId],
      references: [storageLocations.id],
    }),
  })
);
