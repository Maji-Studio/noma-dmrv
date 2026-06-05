import {
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  real,
} from 'drizzle-orm/pg-core';
import { relations, sql, type InferSelectModel } from 'drizzle-orm';
import { biocharProductStatus } from './common';
import { facilities, storageLocations } from './facilities';
import { productionRuns } from './production';

// ============================================
// Enums
// ============================================

export const ingredientType = pgEnum('ingredient_type', [
  'compost',
  'mineral',
  'lime',
  'binder',
  'amendment',
  'other',
]);

// ============================================
// Formulations - Product recipes
// ============================================

export const formulations = pgTable(
  'formulations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "BCF-01"
    name: text('name').notNull(), // e.g., "Raw Biochar", "BCF-01 - Organic"
    biocharRatio: real('biochar_ratio'), // Ratio in [0, 1] — primary compliance field (§9.4.2 <50% rule)
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'formulations_biochar_ratio_range',
      sql`${table.biocharRatio} is null or (${table.biocharRatio} >= 0 and ${table.biocharRatio} <= 1)`
    ),
  ]
);

// ============================================
// Formulation Ingredients - Multi-ingredient recipes
// ============================================

export const formulationIngredients = pgTable(
  'formulation_ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formulationId: uuid('formulation_id')
      .notNull()
      .references(() => formulations.id, { onDelete: 'cascade' }),
    ingredientType: ingredientType('ingredient_type').notNull(),
    name: text('name').notNull(), // Freeform: "cow manure compost", "rock dust", etc.
    ratio: real('ratio'), // Ratio in [0, 1]
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'formulation_ingredients_ratio_range',
      sql`${table.ratio} is null or (${table.ratio} >= 0 and ${table.ratio} <= 1)`
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
  // Nullable: a NULL formulation means a pure-biochar product (no amendment blend).
  formulationId: uuid('formulation_id').references(() => formulations.id),
  linkedProductionRunId: uuid('linked_production_run_id').references(
    () => productionRuns.id
  ),
  composition: jsonb('composition').notNull().default(sql`'{}'::jsonb`),

  // --- Measurements ---
  massKg: real('mass_kg'),
  moistureContentPercent: real('moisture_content_percent'),
  densityKgM3: real('density_kg_m3'),
  waterAddedKg: real('water_added_kg'),

  // --- Location ---
  storageLocationId: uuid('storage_location_id').references(
    () => storageLocations.id
  ),

  // --- Isometric: 12-month stockpiling validity (Soil Storage Module §7.3) ---
  // Set to productionDate + 12 months. Checked at delivery creation to block expired product.
  expiresAt: timestamp('expires_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// Relations
// ============================================

export const formulationsRelations = relations(formulations, ({ many }) => ({
  biocharProducts: many(biocharProducts),
  ingredients: many(formulationIngredients),
}));

export const formulationIngredientsRelations = relations(
  formulationIngredients,
  ({ one }) => ({
    formulation: one(formulations, {
      fields: [formulationIngredients.formulationId],
      references: [formulations.id],
    }),
  })
);

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

// ============================================
// Type Exports
// ============================================

export type Formulation = InferSelectModel<typeof formulations>;
export type FormulationIngredient = InferSelectModel<typeof formulationIngredients>;
export type BiocharProduct = InferSelectModel<typeof biocharProducts>;
