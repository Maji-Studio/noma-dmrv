import { check, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================
// Loss Records - Mass lost at any point in the chain
// Isometric Protocol: Biochar Protocol §8.4.2
// Used to adjust batch CO2e totals for verified losses.
// ============================================

export const lossRecords = pgTable(
  'loss_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(), // e.g., "LR-2025-001"

    // Polymorphic reference — mirrors chain-of-custody pattern
    entityType: text('entity_type').notNull(), // 'production_run' | 'delivery' | 'application' | 'storage'
    entityId: uuid('entity_id').notNull(),

    lossTypeCode: text('loss_type_code').notNull(), // 'residue' | 'spillage' | 'runoff' | 'volatilization' | 'transport_loss' | 'other'
    massKgLost: real('mass_kg_lost').notNull(),
    discoveredAt: timestamp('discovered_at').notNull(),
    cause: text('cause'),
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check('loss_records_mass_kg_lost_non_negative', sql`${table.massKgLost} >= 0`),
  ]
);

export type LossRecord = typeof lossRecords.$inferSelect;
export type NewLossRecord = typeof lossRecords.$inferInsert;
