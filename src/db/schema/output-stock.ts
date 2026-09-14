import { sql } from 'drizzle-orm';
import { type AnyPgColumn, type PgTableExtraConfigValue, check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './auth';
import { binMovements } from './bin-movements';
import { storageLocations } from './facilities';
import { deliveries } from './logistics';
import { exactMassKg, percent } from './numeric-families';
import { productionRuns } from './production';
import { biocharProducts, formulationIngredients } from './products';

/** Frozen evidence used to establish I. Never recompute from an edited intake. */
export const productIngredientSnapshots = pgTable('product_ingredient_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  biocharProductId: uuid('biochar_product_id').notNull(),
  formulationIngredientId: uuid('formulation_ingredient_id').notNull(),
  sourceStorageLocationId: uuid('source_storage_location_id'),
  wetMassKg: exactMassKg('wet_mass_kg').notNull(),
  moisturePercentUsed: percent('moisture_percent_used').notNull(),
  moistureSource: text('moisture_source', { enum: ['oldest_intake', 'operator_override'] }).notNull(),
  /** Original intake identity/evidence, or override reason. */
  moistureSourceSnapshot: jsonb('moisture_source_snapshot').$type<Record<string, unknown>>().notNull(),
  drySolidsKg: exactMassKg('dry_solids_kg').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, t => [
  unique('product_ingredient_snapshots_product_line_unique').on(t.biocharProductId, t.formulationIngredientId),
  foreignKey({ columns: [t.biocharProductId, t.organizationId], foreignColumns: [biocharProducts.id, biocharProducts.organizationId] }),
  foreignKey({ columns: [t.formulationIngredientId, t.organizationId], foreignColumns: [formulationIngredients.id, formulationIngredients.organizationId] }),
  foreignKey({ columns: [t.sourceStorageLocationId, t.organizationId], foreignColumns: [storageLocations.id, storageLocations.organizationId] }),
  check('product_ingredient_snapshot_calculation', sql`${t.drySolidsKg} = round(${t.wetMassKg} * (1 - ${t.moisturePercentUsed} / 100), 3)`),
  check('product_ingredient_snapshot_mass', sql`${t.wetMassKg} >= 0 and ${t.drySolidsKg} >= 0 and ${t.drySolidsKg} <= ${t.wetMassKg} and ${t.moisturePercentUsed} >= 0 and ${t.moisturePercentUsed} <= 100`),
]);

/**
 * Immutable layer effect of a movement. Positive dry mass removes stock;
 * negative mass restores precisely linked original provenance. No intake copy:
 * layer identity is the existing product or completed production row.
 * Delivery projections join here, sharing the same provenance as losses/counts.
 */
export const outputStockAllocations = pgTable('output_stock_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  movementId: uuid('movement_id').notNull(),
  sourceStorageLocationId: uuid('source_storage_location_id').notNull(),
  biocharProductId: uuid('biochar_product_id'),
  productionRunId: uuid('production_run_id'),
  deliveryId: uuid('delivery_id'),
  // Identifies product creation draws, preventing double-counting source snapshots.
  targetBiocharProductId: uuid('target_biochar_product_id'),
  reversesAllocationId: uuid('reverses_allocation_id'),
  dryMassKg: exactMassKg('dry_mass_kg').notNull(),
  /** Signed measured shipment share; null when a count has no wet removal basis. */
  wetMassKg: exactMassKg('wet_mass_kg'),
  /** Exact rational solids/wet shares and frozen B/I/date/order used by planner. */
  basisSnapshot: jsonb('basis_snapshot').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t): PgTableExtraConfigValue[] => [
  foreignKey({ columns: [t.reversesAllocationId, t.organizationId], foreignColumns: [outputStockAllocations.id as AnyPgColumn, outputStockAllocations.organizationId as AnyPgColumn] }),
  check('output_stock_allocations_reversal_link', sql`${t.dryMassKg} >= 0 or (${t.reversesAllocationId} is not null and ${t.reversesAllocationId} <> ${t.id})`),
  unique('output_stock_allocations_id_org_unique').on(t.id, t.organizationId),
  unique('output_stock_allocations_movement_product_unique').on(t.movementId, t.biocharProductId),
  unique('output_stock_allocations_movement_run_unique').on(t.movementId, t.productionRunId),
  index('output_stock_allocations_org_bin_idx').on(t.organizationId, t.sourceStorageLocationId),
  index('output_stock_allocations_org_delivery_idx').on(t.organizationId, t.deliveryId),
  foreignKey({ columns: [t.movementId, t.organizationId], foreignColumns: [binMovements.id, binMovements.organizationId] }),
  foreignKey({ columns: [t.sourceStorageLocationId, t.organizationId], foreignColumns: [storageLocations.id, storageLocations.organizationId] }),
  foreignKey({ columns: [t.biocharProductId, t.organizationId], foreignColumns: [biocharProducts.id, biocharProducts.organizationId] }),
  foreignKey({ columns: [t.productionRunId, t.organizationId], foreignColumns: [productionRuns.id, productionRuns.organizationId] }),
  foreignKey({ columns: [t.targetBiocharProductId, t.organizationId], foreignColumns: [biocharProducts.id, biocharProducts.organizationId] }),
  foreignKey({ columns: [t.deliveryId, t.organizationId], foreignColumns: [deliveries.id, deliveries.organizationId] }),
  check('output_stock_allocations_one_layer', sql`(${t.biocharProductId} is null) <> (${t.productionRunId} is null)`),
  check('output_stock_allocations_delivery_wet_required', sql`${t.deliveryId} is null or ${t.wetMassKg} is not null`),
]);

export const outputStockRunAllocations = pgTable('output_stock_run_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  allocationId: uuid('allocation_id').notNull(),
  productionRunId: uuid('production_run_id').notNull(),
  dryMassKg: exactMassKg('dry_mass_kg').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, t => [
  unique('output_stock_run_allocations_layer_run_unique').on(t.allocationId, t.productionRunId),
  foreignKey({ columns: [t.allocationId, t.organizationId], foreignColumns: [outputStockAllocations.id, outputStockAllocations.organizationId] }),
  foreignKey({ columns: [t.productionRunId, t.organizationId], foreignColumns: [productionRuns.id, productionRuns.organizationId] }),
]);

export type ProductIngredientSnapshot = typeof productIngredientSnapshots.$inferSelect;
export type OutputStockAllocation = typeof outputStockAllocations.$inferSelect;
export type OutputStockRunAllocation = typeof outputStockRunAllocations.$inferSelect;
