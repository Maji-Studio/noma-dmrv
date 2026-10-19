import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, storageLocations, type BinMovement } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { conflictCode } from '@/lib/conflict-ref';
import { DomainError } from '@/lib/domain-errors';
import { SafeError } from '@/lib/errors';
import { findFeedstockLossBlocker, formatFeedstockLossLockReason } from '@/lib/feedstock-loss-lock';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { STOCK_CONFLICT_ENTITY } from '@/lib/stock-conflict-entities';
import { findMovementRequest, lockMovementRequest, requestFingerprint } from './bin-movement-requests';
import { isOverdraw, lockBinStock } from './bin-stock-guards';
import { getFeedstockBinStock } from './feedstock-bin-ledger';
import { assertFeedstockBinLanesNotNegative } from './feedstock-bin-stock-integrity';
import { assertEventTimesNotFuture } from './future-event-time';
import { getOutputStockFacilityTimezone } from './output-stock-dates';
import { OUTPUT_STOCK_FUTURE_TIME_MESSAGE } from './output-stock-post';
import { requireOrgScope } from './utils';

const REPLAY_CONFLICT_MESSAGE =
  'Lost mass was not changed because this request was already saved with different values. Close the form and start again.';
const ALREADY_CORRECTED_MESSAGE = 'This entry has already been corrected. Open its correction instead.';
const NEGATIVE_BALANCE_MESSAGE =
  'Not enough wet feedstock at this time or after a later movement. Check the date and time or reduce the loss.';

export interface CorrectFeedstockLossInput {
  storageLocationId: string;
  correctsMovementId: string;
  idempotencyKey: string;
  reason: string;
  replacement: { occurredAt: Date; lossMassKg: number } | null;
}

/** Restore exactly one recorded loss, optionally replacing it with a new loss. */
export async function correctFeedstockLoss(ctx: OrgContext, input: CorrectFeedstockLossInput): Promise<BinMovement> {
  requireOrgScope(ctx);
  return db.transaction(async tx => {
    if (input.replacement) {
      if (!input.replacement.occurredAt || !Number.isFinite(input.replacement.occurredAt.getTime())) {
        throw new SafeError('Enter the date and time.');
      }
      assertEventTimesNotFuture(
        { occurredAt: input.replacement.occurredAt },
        { occurredAt: OUTPUT_STOCK_FUTURE_TIME_MESSAGE },
        new Date(),
      );
      if (!Number.isFinite(input.replacement.lossMassKg) || input.replacement.lossMassKg <= 0) {
        throw new SafeError('Lost mass must be greater than 0.');
      }
    }
    const payload = {
      storageLocationId: input.storageLocationId,
      correctsMovementId: input.correctsMovementId,
      reason: input.reason,
      replacement: input.replacement && {
        occurredAt: input.replacement.occurredAt.toISOString(),
        lossMassKg: input.replacement.lossMassKg,
      },
    };
    // Request lock precedes the bin lock so concurrent twins replay the result.
    await lockMovementRequest(ctx, tx, input.idempotencyKey);
    const existing = await findMovementRequest(ctx, tx, {
      idempotencyKey: input.idempotencyKey,
      payload,
      storageLocationId: input.storageLocationId,
      conflictMessage: REPLAY_CONFLICT_MESSAGE,
    });
    if (existing) return existing;

    await lockBinStock(ctx, tx, input.storageLocationId);
    const [original] = await tx.select().from(binMovements).where(and(
      eq(binMovements.organizationId, ctx.organizationId),
      eq(binMovements.storageLocationId, input.storageLocationId),
      eq(binMovements.id, input.correctsMovementId),
    ));
    if (!original || original.lane !== 'feedstock' || original.movementType !== 'loss') {
      throw new SafeError('Choose a Lost mass entry in this feedstock bin to correct.');
    }
    const [reversed] = await tx.select({ id: binMovements.id }).from(binMovements).where(and(
      eq(binMovements.organizationId, ctx.organizationId),
      eq(binMovements.correctsMovementId, original.id),
      eq(binMovements.movementType, 'adjustment'),
    ));
    if (reversed) throw new SafeError(ALREADY_CORRECTED_MESSAGE);

    const stock = await getFeedstockBinStock(ctx, input.storageLocationId, tx);
    const blocker = findFeedstockLossBlocker(stock.entries, original.id);
    if (blocker) {
      const [bin] = await tx.select({ code: storageLocations.code, facilityId: storageLocations.facilityId })
        .from(storageLocations).where(and(
          eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, input.storageLocationId),
        ));
      if (!bin) throw new SafeError('Storage bin not found');
      const timeZone = await getOutputStockFacilityTimezone(ctx, bin.facilityId, tx);
      const entity = blocker.kind === 'run_draw' ? STOCK_CONFLICT_ENTITY.productionRun
        : blocker.kind === 'ingredient_draw' ? STOCK_CONFLICT_ENTITY.biocharProduct : STOCK_CONFLICT_ENTITY.binMovement;
      throw new DomainError('certification_locked', formatFeedstockLossLockReason(blocker, timeZone), {
        conflict: { entity: STOCK_CONFLICT_ENTITY.storageLocation, id: input.storageLocationId, code: conflictCode(bin.code) },
        blockers: [{ entity, id: blocker.sourceId ?? blocker.id,
          code: conflictCode(blocker.code ?? `${blocker.reason} (${formatFacilityDateTime(blocker.occurredAt, timeZone)})`) }],
      });
    }

    const snapshot = { ...payload, actorId: ctx.userId, payloadHash: requestFingerprint(payload) };
    const [reversal] = await tx.insert(binMovements).values({
      organizationId: ctx.organizationId,
      storageLocationId: input.storageLocationId,
      lane: 'feedstock',
      movementType: 'adjustment',
      massDeltaKg: -original.massDeltaKg,
      occurredAt: original.occurredAt,
      correctsMovementId: original.id,
      reason: input.reason,
      createdBy: ctx.userId,
      idempotencyKey: input.replacement ? `${input.idempotencyKey}:reversal` : input.idempotencyKey,
      inputSnapshot: { ...snapshot, kind: 'reversal' },
    }).returning();

    let saved = reversal;
    if (input.replacement) {
      [saved] = await tx.insert(binMovements).values({
        organizationId: ctx.organizationId,
        storageLocationId: input.storageLocationId,
        lane: 'feedstock',
        movementType: 'loss',
        massDeltaKg: -input.replacement.lossMassKg,
        occurredAt: input.replacement.occurredAt,
        correctsMovementId: original.id,
        reason: input.reason,
        createdBy: ctx.userId,
        idempotencyKey: input.idempotencyKey,
        inputSnapshot: { ...snapshot, kind: 'replacement',
          lane: 'feedstock', movementType: 'loss', massDeltaKg: -input.replacement.lossMassKg,
          occurredAt: input.replacement.occurredAt.toISOString() },
      }).returning();
    }
    // A reversal only raises balances, so only entries from the replacement's time on can go below zero.
    const correctedStock = input.replacement ? await getFeedstockBinStock(ctx, input.storageLocationId, tx) : null;
    const replacementAt = input.replacement?.occurredAt.toISOString() ?? '';
    if (correctedStock?.entries.some(entry => entry.occurredAt >= replacementAt && isOverdraw(0, entry.afterWetKg))) {
      throw new DomainError('validation_failed', NEGATIVE_BALANCE_MESSAGE, {
        issues: [{ path: ['occurredAt'], code: 'validation_failed', message: NEGATIVE_BALANCE_MESSAGE }],
      });
    }
    await assertFeedstockBinLanesNotNegative(ctx, tx, [input.storageLocationId], 'save');
    return saved;
  });
}
