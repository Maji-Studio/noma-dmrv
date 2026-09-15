import { relations, sql } from 'drizzle-orm';
import { bigserial, check, date, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn, type PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { binMovementLane, binMovementType } from './common';
import { storageLocations } from './facilities';
import { exactMassKg, fraction, massKg } from './numeric-families';

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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    storageLocationId: uuid('storage_location_id')
      .notNull()
      .references(() => storageLocations.id),
    lane: binMovementLane('lane').notNull(),
    movementType: binMovementType('movement_type').notNull(),
    // Signed delta in the lane's native stock unit. Feedstock is wet kg;
    // output events use dry biochar kg alongside their explicit output delta.
    // Losses are negative; append-only reversals may be positive.
    massDeltaKg: massKg('mass_delta_kg').notNull(),
    // Required for both types so a verifier always knows what happened.
    reason: text('reason').notNull(),
    // Set null on user deletion — we keep the audit row, drop the PII link.
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Stock-take snapshot, populated only on adjustments recorded from a count.
    // countedMassKg and derivedMassKgAtTime are in the lane's native unit
    // (wet for feedstock). Moisture remains snapshot metadata only.
    countedMassKg: massKg('counted_mass_kg'),
    derivedMassKgAtTime: massKg('derived_mass_kg_at_time'),
    countedWetMassKg: massKg('counted_wet_mass_kg'),
    moistureRatioUsed: fraction('moisture_ratio_used'),
    // Output events carry exact dry effects and an immutable measurement basis.
    outputKind: text('output_kind', { enum: ['production_draw', 'product_draw', 'delivery', 'loss', 'count', 'reversal', 'replacement'] }),
    physicalDate: date('physical_date'),
    postingSequence: bigserial('posting_sequence', { mode: 'bigint' }).notNull(),
    idempotencyKey: text('idempotency_key'),
    basisFingerprint: text('basis_fingerprint'),
    inputSnapshot: jsonb('input_snapshot').$type<Record<string, unknown>>(),
    outputDryDeltaKg: exactMassKg('output_dry_delta_kg'),
    balanceBeforeDryKg: exactMassKg('balance_before_dry_kg'),
    balanceAfterDryKg: exactMassKg('balance_after_dry_kg'),
    correctsMovementId: uuid('corrects_movement_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique('bin_movements_id_org_unique').on(table.id, table.organizationId),
    unique('bin_movements_org_idempotency_unique').on(table.organizationId, table.idempotencyKey),
    foreignKey({ columns: [table.storageLocationId, table.organizationId], foreignColumns: [storageLocations.id, storageLocations.organizationId] }),
    foreignKey({ columns: [table.correctsMovementId, table.organizationId], foreignColumns: [binMovements.id as AnyPgColumn, binMovements.organizationId as AnyPgColumn] }),
    check('bin_movements_output_contract', sql`${table.outputKind} is null or (
      ${table.lane} in ('biochar', 'product') and ${table.physicalDate} is not null
      and ${table.idempotencyKey} is not null and length(${table.idempotencyKey}) > 0
      and ${table.basisFingerprint} is not null and ${table.inputSnapshot} is not null
      and ${table.balanceBeforeDryKg} >= 0 and ${table.balanceAfterDryKg} >= 0
      and ${table.balanceBeforeDryKg} is not null and ${table.balanceAfterDryKg} is not null
      and ${table.outputDryDeltaKg} is not null
      and ${table.balanceAfterDryKg} = ${table.balanceBeforeDryKg} + ${table.outputDryDeltaKg}
      and (${table.outputKind} = 'reversal' or ${table.outputDryDeltaKg} <= 0)
      and length(trim(${table.reason})) > 0
      and (${table.outputKind} not in ('reversal', 'replacement') or ${table.correctsMovementId} is not null)
    )`),
    check('bin_movements_no_self_correction', sql`${table.correctsMovementId} is null or ${table.correctsMovementId} <> ${table.id}`),
    index('bin_movements_organization_id_idx').on(table.organizationId),
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
