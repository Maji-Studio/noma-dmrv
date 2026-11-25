import { toReturnMovement, type ReturnMovement } from '@/lib/production-run-returns/movement';
import { db, type DbTransaction } from '@/db';
import { binMovements, type BinMovement } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { retryTransaction } from '@/lib/db/transaction-retry';
import { assertReturnTime, remainingReturnDryKg, returnMassBasis, RETURN_SNAPSHOT_VERSION } from '@/lib/production-run-returns/mass';
import { recordProductionRunReturnSchema, type RecordProductionRunReturnInput, type ReturnMeasurement } from '@/schemas/production-run-returns';
import { findMovementRequest, lockMovementRequest, requestFingerprint } from '../bin-movement-requests';
import { replayFeedstockBinStock } from '../feedstock-bin-ledger';
import { SafeError } from '@/lib/errors';
import { requireOrgScope } from '../utils';
import { lockReturnSource } from './locks';
import { validateReturnDestination } from './queries';

/** A boundary before every event: replay validates the bin's whole history, empty-at-switch checks included. */
const WHOLE_HISTORY_BOUNDARY = { occurredAt: '' } as const;

export const RETURN_REPLAY_CONFLICT = 'Return was not saved because this request already has different values. Start a new return entry.';
/** The operation runner supplies its transactional capture. Replays never capture again. */
export interface ReturnWriteOptions { capture?: (sourceRunId: string, before: ReturnMovement | null, after: ReturnMovement | { reversal: ReturnMovement; replacement: ReturnMovement | null }) => void }
export type LockedReturnSource = Awaited<ReturnType<typeof lockReturnSource>>;

export async function insertReturn(ctx: OrgContext, tx: DbTransaction, source: LockedReturnSource, input: ReturnMeasurement,
  request: { idempotencyKey: string; payload: unknown; correctsMovementId?: string; createdAt?: Date }): Promise<BinMovement> {
  requireOrgScope(ctx);
  await validateReturnDestination(ctx, tx, input.storageLocationId, source.run.facilityId, source.returnedFeedstockTypeId);
  assertReturnTime(new Date(input.occurredAt), source.run.endTime, new Date());
  const mass = returnMassBasis(input.wetMassKg, input.moisturePercent);
  remainingReturnDryKg(source.consumedDryKg, [...source.history.map(row => row.feedstockDryDeltaKg!), mass.dryKg]);
  const [saved] = await tx.insert(binMovements).values({
    organizationId: ctx.organizationId, storageLocationId: input.storageLocationId, lane: 'feedstock', movementType: 'failed_run_return',
    massDeltaKg: mass.wetKg, feedstockDryDeltaKg: mass.dryKg, moistureRatioUsed: mass.moistureRatio,
    sourceProductionRunId: source.run.id, returnedFeedstockTypeId: source.returnedFeedstockTypeId,
    occurredAt: new Date(input.occurredAt), reason: input.reason, createdBy: ctx.userId, createdAt: request.createdAt ?? new Date(),
    idempotencyKey: request.idempotencyKey, correctsMovementId: request.correctsMovementId,
    inputSnapshot: { version: RETURN_SNAPSHOT_VERSION, sourceRunVersion: source.run.version, actorId: ctx.userId,
      payloadHash: requestFingerprint(request.payload), consumedDryKg: source.consumedDryKg,
      consumedWetKg: source.run.feedstockWetMassKg, runMoisturePercent: source.run.feedstockMoisturePercent,
      allocations: source.allocations, draws: source.draws.map(row => ({ id: row.id, storageLocationId: row.storageLocationId, wetMassKg: row.wetMassKg })),
      measurement: { ...input, occurredAt: input.occurredAt } },
  }).returning();
  return saved;
}

export async function assertReturnBalances(ctx: OrgContext, tx: DbTransaction, binIds: readonly string[]) {
  requireOrgScope(ctx);
  for (const binId of new Set(binIds)) {
    const stock = await replayFeedstockBinStock(ctx, binId, tx, { boundary: WHOLE_HISTORY_BOUNDARY });
    if (stock.currentWetKg < 0 || stock.entries.some(entry => entry.afterWetKg < 0)) {
      throw new SafeError('Return was not saved. A bin would have negative wet stock. Review its movement history.');
    }
  }
}

export async function recordProductionRunReturnInTransaction(ctx: OrgContext, tx: DbTransaction, raw: RecordProductionRunReturnInput, options: ReturnWriteOptions = {}) {
  requireOrgScope(ctx);
  const input = recordProductionRunReturnSchema.parse(raw);
  const { idempotencyKey, ...payload } = input;
  await lockMovementRequest(ctx, tx, idempotencyKey);
  const existing = await findMovementRequest(ctx, tx, { idempotencyKey, payload, storageLocationId: input.storageLocationId, conflictMessage: RETURN_REPLAY_CONFLICT });
  if (existing) return existing;
  const source = await lockReturnSource(ctx, tx, input.sourceProductionRunId, [input.storageLocationId]);
  const saved = await insertReturn(ctx, tx, source, input, { idempotencyKey, payload });
  await assertReturnBalances(ctx, tx, [input.storageLocationId]);
  options.capture?.(source.run.id, null, toReturnMovement(saved));
  return saved;
}

export async function recordProductionRunReturn(ctx: OrgContext, input: RecordProductionRunReturnInput) {
  requireOrgScope(ctx);
  return retryTransaction(() => db.transaction(tx => recordProductionRunReturnInTransaction(ctx, tx, input)));
}
