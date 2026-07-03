import { type AnyPgColumn, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { biocharProducts } from './products';
import { storageLocations } from './facilities';
import { massKg } from './numeric-families';

// ============================================
// Biochar Storage Inventory - Product batches in storage bins
// Tracks which biochar product batch is in which bin and how much remains.
// Expiry is on biocharProduct.expiresAt (production date + 12 months) — not on the bin.
// Transfers between bins are allowed: create a new record at the destination,
// decrement quantityKgRemaining on the source, and set sourceInventoryId for audit trail.
// ============================================

export const biocharStorageInventory = pgTable(
  'biochar_storage_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "BSI-2025-001"
    biocharProductId: uuid('biochar_product_id')
      .notNull()
      .references(() => biocharProducts.id),
    storageLocationId: uuid('storage_location_id')
      .notNull()
      .references(() => storageLocations.id),
    quantityKgStored: massKg('quantity_kg_stored').notNull(), // Initial amount placed in bin
    quantityKgRemaining: massKg('quantity_kg_remaining').notNull(), // Decremented by deliveries/transfers
    storedAt: timestamp('stored_at').notNull(),
    // Set when this record was created by transferring from another bin
    sourceInventoryId: uuid('source_inventory_id').references(
      (): AnyPgColumn => biocharStorageInventory.id
    ),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'biochar_storage_inventory_qty_remaining_non_negative',
      sql`${table.quantityKgRemaining} >= 0`
    ),
    check(
      'biochar_storage_inventory_qty_remaining_lte_stored',
      sql`${table.quantityKgRemaining} <= ${table.quantityKgStored}`
    ),
    check(
      'biochar_storage_inventory_qty_stored_positive',
      sql`${table.quantityKgStored} > 0`
    ),
    check(
      'biochar_storage_inventory_no_self_transfer',
      sql`${table.sourceInventoryId} IS NULL OR ${table.sourceInventoryId} <> ${table.id}`
    ),
  ]
);

export const biocharStorageInventoryRelations = relations(
  biocharStorageInventory,
  ({ one }) => ({
    biocharProduct: one(biocharProducts, {
      fields: [biocharStorageInventory.biocharProductId],
      references: [biocharProducts.id],
    }),
    storageLocation: one(storageLocations, {
      fields: [biocharStorageInventory.storageLocationId],
      references: [storageLocations.id],
    }),
    sourceInventory: one(biocharStorageInventory, {
      fields: [biocharStorageInventory.sourceInventoryId],
      references: [biocharStorageInventory.id],
      relationName: 'transferSource',
    }),
  })
);

export type BiocharStorageInventory = typeof biocharStorageInventory.$inferSelect;
export type NewBiocharStorageInventory = typeof biocharStorageInventory.$inferInsert;
