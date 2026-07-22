import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  real,
} from 'drizzle-orm/pg-core';
import { relations, sql, type InferSelectModel } from 'drizzle-orm';
import { biocharProductStatus } from './common';
import { fraction, massKg, percent } from './numeric-families';
import { facilities, storageLocations } from './facilities';
import { feedstockTypes } from './feedstock';
import { productionRuns } from './production';
import { organizations } from './auth';

// ============================================
// Formulations - Product recipes
// ============================================

export const formulations = pgTable(
  'formulations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(), // e.g., "BCF-01"
    name: text('name').notNull(), // e.g., "Raw Biochar", "BCF-01 - Organic"
    biocharRatio: fraction('biochar_ratio'), // Ratio in [0, 1] — primary compliance field (§9.4.2 <50% rule)
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('formulations_organization_id_code_unique').on(table.organizationId, table.code),
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    formulationId: uuid('formulation_id')
      .notNull()
      .references(() => formulations.id, { onDelete: 'cascade' }),
    feedstockTypeId: uuid('feedstock_type_id')
      .notNull()
      .references(() => feedstockTypes.id),
    ratio: fraction('ratio'), // Ratio in [0, 1]
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('formulation_ingredients_organization_id_idx').on(table.organizationId),
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
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  code: text('code').notNull(), // e.g., "BP-2025-043"
  facilityId: uuid('facility_id')
    .notNull(),
  productionDate: timestamp('production_date').defaultNow().notNull(),
  status: biocharProductStatus('status').default('testing').notNull(),

  // --- Composition ---
  // Nullable: a NULL formulation means a pure-biochar product (no amendment blend).
  formulationId: uuid('formulation_id').references(() => formulations.id),
  // Snapshot of the formulation's biocharRatio taken when the product is
  // created (or its formulation reassigned). Stock math and roll-ups read this
  // snapshot, not the live formulation, so later recipe edits never rewrite an
  // existing product's biochar-equivalent draw. NULL falls back to the live
  // formulation ratio (legacy rows), then 1 (pure biochar).
  biocharRatio: fraction('biochar_ratio'),
  linkedProductionRunId: uuid('linked_production_run_id'),
  composition: jsonb('composition').notNull().default(sql`'{}'::jsonb`),

  // --- Measurements ---
  massKg: massKg('mass_kg'),
  moistureContentPercent: percent('moisture_content_percent'),
  densityKgM3: real('density_kg_m3'),
  waterAddedKg: massKg('water_added_kg'),

  // --- Location ---
  storageLocationId: uuid('storage_location_id').references(
    () => storageLocations.id
  ),

  // --- Isometric: 12-month stockpiling validity (Soil Storage Module §7.3) ---
  // Set to productionDate + 12 months. Checked at delivery creation to block expired product.
  expiresAt: timestamp('expires_at'),

  // Stamped by the facility archive cascade; NULL = active
  archivedAt: timestamp('archived_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('biochar_products_organization_id_code_unique').on(table.organizationId, table.code),
  check(
    'biochar_products_biochar_ratio_range',
    sql`${table.biocharRatio} is null or (${table.biocharRatio} >= 0 and ${table.biocharRatio} <= 1)`
  ),
  foreignKey({
    columns: [table.facilityId, table.organizationId],
    foreignColumns: [facilities.id, facilities.organizationId],
  }),
  foreignKey({
    columns: [table.linkedProductionRunId, table.organizationId],
    foreignColumns: [productionRuns.id, productionRuns.organizationId],
  }),
]);

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
    feedstockType: one(feedstockTypes, {
      fields: [formulationIngredients.feedstockTypeId],
      references: [feedstockTypes.id],
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
