import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { storageLocations } from './facilities';
import { users } from './auth';
import { binMovementLane, binMovementType } from './common';
import { fraction, massKg } from './numeric-families';

// ============================================
// Bin Movements — append-only reconciliation ledger (issue #194)
// ============================================
// A verifier-legible record of manual stock corrections and documented losses
// per bin and material lane. Rows are NEVER updated or deleted — a mistake is
// corrected with a compensating movement. Derived stock overlays the signed
// sum of these deltas onto each lane's computed mass; movements never mutate
// biochar_storage_inventory or any source-of-truth rows.

export const binMovements = pgTable(
  'bin_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storageLocationId: uuid('storage_location_id')
      .notNull()
      .references(() => storageLocations.id),
    lane: binMovementLane('lane').notNull(),
    movementType: binMovementType('movement_type').notNull(),
    // Signed delta. Dry kg for the feedstock lane, as-is kg otherwise.
    // Losses are always negative; adjustments may be either sign.
    massDeltaKg: massKg('mass_delta_kg').notNull(),
    // Required for both types so a verifier always knows what happened.
    reason: text('reason').notNull(),
    // Set null on user deletion — we keep the audit row, drop the PII link.
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Stock-take snapshot — populated only on adjustments recorded from a count.
    // countedMassKg is in the lane's native unit (dry for feedstock); the wet
    // count + moisture ratio record how the dry figure was derived.
    countedMassKg: massKg('counted_mass_kg'),
    derivedMassKgAtTime: massKg('derived_mass_kg_at_time'),
    countedWetMassKg: massKg('counted_wet_mass_kg'),
    moistureRatioUsed: fraction('moisture_ratio_used'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('bin_movements_storage_location_lane_idx').on(
      table.storageLocationId,
      table.lane
    ),
    // A documented loss can only ever remove material.
    check(
      'bin_movements_loss_is_negative',
      sql`${table.movementType} <> 'loss' OR ${table.massDeltaKg} < 0`
    ),
  ]
);

export const binMovementsRelations = relations(binMovements, ({ one }) => ({
  storageLocation: one(storageLocations, {
    fields: [binMovements.storageLocationId],
    references: [storageLocations.id],
  }),
  createdByUser: one(users, {
    fields: [binMovements.createdBy],
    references: [users.id],
  }),
}));

export type BinMovement = typeof binMovements.$inferSelect;
export type NewBinMovement = typeof binMovements.$inferInsert;
