import { toReturnMovement } from '@/lib/production-run-returns/movement';
import { and, eq, sql } from 'drizzle-orm';
import { db, type DbTransaction } from '@/db';
import { binMovements, type BinMovement } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { retryTransaction } from '@/lib/db/transaction-retry';
import { SafeError } from '@/lib/errors';
import { findFeedstockLossBlocker } from '@/lib/feedstock-loss-lock';
import { reverseReturnMass, RETURN_SNAPSHOT_VERSION } from '@/lib/production-run-returns/mass';
import { correctProductionRunReturnSchema, type CorrectProductionRunReturnInput } from '@/schemas/production-run-returns';
import { findMovementRequest, lockMovementRequest, requestFingerprint } from '../bin-movement-requests';
import { getFeedstockBinStock } from '../feedstock-bin-ledger';
import { throwFeedstockLossLockError } from '../feedstock-loss-lock';
import { requireOrgScope } from '../utils';
import { lockReturnSource } from './locks';
import { getProductionRunReturnAllowance } from './queries';
import { assertReturnBalances, insertReturn, RETURN_REPLAY_CONFLICT, type ReturnWriteOptions } from './writer';

const RECORDED_TIME_STEP_MS = 1;
/** Append one exact reversal and optional freshly measured replacement, atomically. */
export async function correctProductionRunReturnInTransaction(ctx: OrgContext, tx: DbTransaction, raw: CorrectProductionRunReturnInput, options: ReturnWriteOptions = {}) {
  requireOrgScope(ctx);
  const input = correctProductionRunReturnSchema.parse(raw);
  const { idempotencyKey, ...payload } = input;
  await lockMovementRequest(ctx, tx, idempotencyKey);
  const existing = await findMovementRequest(ctx, tx, { idempotencyKey, payload, storageLocationId: input.storageLocationId, conflictMessage: RETURN_REPLAY_CONFLICT });
  if (existing) return existing;
  const affectedBins = [input.storageLocationId, ...(input.replacement ? [input.replacement.storageLocationId] : [])];
  const source = await lockReturnSource(ctx, tx, input.sourceProductionRunId, affectedBins);
  const [original] = await tx.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId),
    eq(binMovements.id, input.correctsMovementId), eq(binMovements.sourceProductionRunId, input.sourceProductionRunId),
    eq(binMovements.storageLocationId, input.storageLocationId), eq(binMovements.movementType, 'failed_run_return')));
  if (!original) throw new SafeError('Choose a failed-run return to correct.');
  if (source.history.some(row => row.movementType === 'failed_run_return_reversal' && row.correctsMovementId === original.id)) {
    throw new SafeError('This return has already been reversed.');
  }
  const stock = await getFeedstockBinStock(ctx, original.storageLocationId, tx);
  const blocker = findFeedstockLossBlocker(stock.entries, original.id);
  if (blocker) await throwFeedstockLossLockError(ctx, tx, original.storageLocationId, blocker);
  // A recording time after existing entries keeps equal physical times deterministic.
  // org-scope-ok: database wall clock has no tenant-owned rows.
  const { rows: [clock] } = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  const createdAt = new Date(stock.entries.reduce((latest, entry) => Math.max(latest,
    new Date(entry.recordedAt).getTime() + RECORDED_TIME_STEP_MS), new Date(clock.now).getTime()));
  const [reversal] = await tx.insert(binMovements).values({
    organizationId: ctx.organizationId, storageLocationId: original.storageLocationId, lane: 'feedstock',
    movementType: 'failed_run_return_reversal', ...reverseReturnMass(original),
    sourceProductionRunId: original.sourceProductionRunId, returnedFeedstockTypeId: original.returnedFeedstockTypeId,
    occurredAt: original.occurredAt, createdAt, createdBy: ctx.userId, reason: input.reason,
    correctsMovementId: original.id, idempotencyKey,
    inputSnapshot: { ...original.inputSnapshot, version: RETURN_SNAPSHOT_VERSION, actorId: ctx.userId,
      payloadHash: requestFingerprint(payload), correction: payload, kind: 'reversal' },
  }).returning();
  let replacement: BinMovement | null = null;
  if (input.replacement) {
    const refreshed = await getProductionRunReturnAllowance(ctx, input.sourceProductionRunId, tx);
    replacement = await insertReturn(ctx, tx, refreshed, input.replacement, {
      idempotencyKey: `return-replacement:${requestFingerprint({ idempotencyKey })}`, payload,
      correctsMovementId: original.id, createdAt,
    });
  }
  await assertReturnBalances(ctx, tx, affectedBins);
  options.capture?.(source.run.id, toReturnMovement(original), { reversal: toReturnMovement(reversal), replacement: replacement ? toReturnMovement(replacement) : null });
  return reversal;
}

export async function correctProductionRunReturn(ctx: OrgContext, input: CorrectProductionRunReturnInput) {
  requireOrgScope(ctx);
  return retryTransaction(() => db.transaction(tx => correctProductionRunReturnInTransaction(ctx, tx, input)));
}
