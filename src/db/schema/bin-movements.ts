import { relations, sql } from 'drizzle-orm';
import { bigserial, check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn, type PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { binMovementLane, binMovementType } from './common';
import { productionRuns } from './production';
import { feedstockTypes } from './feedstock';
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
    outputKind: text('output_kind', { enum: ['production_draw', 'product_draw', 'delivery', 'loss', 'count', 'reversal', 'replacement', 'merge', 'split'] }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    postingSequence: bigserial('posting_sequence', { mode: 'bigint' }).notNull(),
    idempotencyKey: text('idempotency_key'),
    basisFingerprint: text('basis_fingerprint'),
    inputSnapshot: jsonb('input_snapshot').$type<Record<string, unknown>>(),
    outputDryDeltaKg: exactMassKg('output_dry_delta_kg'),
    balanceBeforeDryKg: exactMassKg('balance_before_dry_kg'),
    balanceAfterDryKg: exactMassKg('balance_after_dry_kg'),
    sourceProductionRunId: uuid('source_production_run_id'),
    returnedFeedstockTypeId: uuid('returned_feedstock_type_id'),
    feedstockDryDeltaKg: massKg('feedstock_dry_delta_kg'),
    correctsMovementId: uuid('corrects_movement_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique('bin_movements_id_org_unique').on(table.id, table.organizationId),
    unique('bin_movements_org_idempotency_unique').on(table.organizationId, table.idempotencyKey),
    foreignKey({ columns: [table.storageLocationId, table.organizationId], foreignColumns: [storageLocations.id, storageLocations.organizationId] }),
    foreignKey({ columns: [table.correctsMovementId, table.organizationId], foreignColumns: [binMovements.id as AnyPgColumn, binMovements.organizationId as AnyPgColumn] }),
    foreignKey({ columns: [table.sourceProductionRunId, table.organizationId], foreignColumns: [productionRuns.id, productionRuns.organizationId] }).onDelete('restrict'),
    foreignKey({ columns: [table.returnedFeedstockTypeId, table.organizationId], foreignColumns: [feedstockTypes.id, feedstockTypes.organizationId] }).onDelete('restrict'),
    index('bin_movements_source_run_idx').on(table.organizationId, table.sourceProductionRunId),
    // Only a failed-run return reversal has a source run and a negative wet delta
    // (bin_movements_return_contract). The predicate avoids the enum: a value
    // added in the same migration cannot be used before it is committed.
    uniqueIndex('bin_movements_one_return_reversal').on(table.organizationId, table.correctsMovementId)
      .where(sql`${table.sourceProductionRunId} is not null and ${table.massDeltaKg} < 0`),
    check('bin_movements_return_contract', sql`${table.movementType}::text not in ('failed_run_return', 'failed_run_return_reversal') or (
      ${table.lane} = 'feedstock' and ${table.outputKind} is null
      and ${table.sourceProductionRunId} is not null and ${table.returnedFeedstockTypeId} is not null
      and ${table.feedstockDryDeltaKg} is not null and ${table.occurredAt} is not null
      and ${table.moistureRatioUsed} is not null and ${table.moistureRatioUsed} >= 0 and ${table.moistureRatioUsed} < 1
      and ${table.idempotencyKey} is not null and length(trim(${table.idempotencyKey})) > 0
      and ${table.inputSnapshot} is not null and jsonb_typeof(${table.inputSnapshot}) = 'object'
      and ${table.inputSnapshot} ?& array['version', 'sourceRunVersion', 'actorId', 'consumedDryKg', 'consumedWetKg', 'runMoisturePercent', 'allocations', 'draws']
      and jsonb_typeof(${table.inputSnapshot}->'version') = 'number'
      and jsonb_typeof(${table.inputSnapshot}->'sourceRunVersion') = 'number'
      and jsonb_typeof(${table.inputSnapshot}->'actorId') = 'string'
      and jsonb_typeof(${table.inputSnapshot}->'consumedDryKg') = 'number'
      and jsonb_typeof(${table.inputSnapshot}->'consumedWetKg') = 'number'
      and jsonb_typeof(${table.inputSnapshot}->'runMoisturePercent') = 'number'
      and jsonb_typeof(${table.inputSnapshot}->'allocations') = 'array'
      and jsonb_typeof(${table.inputSnapshot}->'draws') = 'array'
      and length(trim(${table.reason})) > 0
      and ${table.countedMassKg} is null and ${table.countedWetMassKg} is null
      and ${table.outputDryDeltaKg} is null
      and abs(${table.feedstockDryDeltaKg}) <= abs(${table.massDeltaKg})
      and ((${table.movementType}::text = 'failed_run_return' and ${table.massDeltaKg} > 0 and ${table.feedstockDryDeltaKg} > 0)
        or (${table.movementType}::text = 'failed_run_return_reversal' and ${table.massDeltaKg} < 0
          and ${table.feedstockDryDeltaKg} < 0 and ${table.correctsMovementId} is not null))
    )`),
    check('bin_movements_return_fields_only', sql`${table.movementType}::text in ('failed_run_return', 'failed_run_return_reversal') or (
      ${table.sourceProductionRunId} is null and ${table.returnedFeedstockTypeId} is null and ${table.feedstockDryDeltaKg} is null
    )`),
    check('bin_movements_feedstock_loss_time', sql`${table.lane} <> 'feedstock' or ${table.movementType} <> 'loss' or ${table.occurredAt} is not null`),
    check('bin_movements_output_contract', sql`${table.outputKind} is null or (
      ${table.lane} in ('biochar', 'product') and ${table.occurredAt} is not null
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
  correctedMovement: one(binMovements, { relationName: 'returnCorrection', fields: [binMovements.correctsMovementId, binMovements.organizationId], references: [binMovements.id, binMovements.organizationId] }),
  sourceProductionRun: one(productionRuns, { fields: [binMovements.sourceProductionRunId, binMovements.organizationId], references: [productionRuns.id, productionRuns.organizationId] }),
  returnedFeedstockType: one(feedstockTypes, { fields: [binMovements.returnedFeedstockTypeId, binMovements.organizationId], references: [feedstockTypes.id, feedstockTypes.organizationId] }),
  createdByUser: one(users, {
    fields: [binMovements.createdBy],
    references: [users.id],
  }),
}));

export type BinMovement = typeof binMovements.$inferSelect;
export type NewBinMovement = typeof binMovements.$inferInsert;
