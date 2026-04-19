import { check, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lossEntityType, lossTypeCode } from './common';

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

    entityType: lossEntityType('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),

    lossTypeCode: lossTypeCode('loss_type_code').notNull(),
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
