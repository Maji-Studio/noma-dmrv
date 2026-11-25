/** Real database contracts. Migration and execution belong to the next implementation run. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, facilities, feedstocks, feedstockTypes, productionRunFeedstocks, productionRunFeedstockDraws, productionRuns, storageLocations, users } from '@/db/schema';
import { recordProductionRunReturn, recordProductionRunReturnInTransaction, correctProductionRunReturn, getProductionRunReturnHistory } from '@/data-access/production-run-returns';
import { deriveLaneStock } from '@/data-access/lane-stock-derivation';
import { getFeedstockBinStock, replayFeedstockBinStock } from '@/data-access/feedstock-bin-ledger';
import { createBinMovement, recordStockTakeMovement } from '@/data-access/bin-movements';
import { createProductionRunFixture, createTestPool, removeIntakeFixture } from './helpers/operation-fixture';
import { openOperationBarrier, waitForBlockedOperations } from './helpers/operation-barrier';
import type { RecordProductionRunReturnInput } from '@/schemas/production-run-returns';
import { ActionConflictError } from '@/lib/errors';
import { STOCK_CONFLICT_ENTITY } from '@/lib/stock-conflict-entities';

const TIMEOUT_MS = 30_000;
const CONSUMED_WET_KG = 100;
const CONSUMED_DRY_KG = 80;
const RETURN_AT = '2026-01-02T12:00:00.000Z';
let fixture: Awaited<ReturnType<typeof createProductionRunFixture>>;
let foreign: Awaited<ReturnType<typeof createProductionRunFixture>>;
let runId: string;
let binId: string;
let secondBinId: string;
let intakeId: string;
let actorId: string;

async function taggedBin() {
  const tag = crypto.randomUUID();
  const [bin] = await db.insert(storageLocations).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    code: `RETURN-${tag}`, name: `Returned material ${tag}`, type: 'feedstock_bin', uncarbonized: true, feedstockTypeId: fixture.feedstockTypeId }).returning();
  return bin.id;
}
function input(patch: Partial<RecordProductionRunReturnInput> = {}): RecordProductionRunReturnInput {
  return { sourceProductionRunId: runId, storageLocationId: binId, wetMassKg: 50, moisturePercent: 20,
    occurredAt: RETURN_AT, reason: 'Failed batch returned', idempotencyKey: crypto.randomUUID(), ...patch };
}
function correction(originalId: string, replacement: RecordProductionRunReturnInput | null = null) {
  return { sourceProductionRunId: runId, storageLocationId: binId, correctsMovementId: originalId,
    idempotencyKey: crypto.randomUUID(), reason: 'Correct measured return', replacement };
}

beforeEach(async () => {
  fixture = await createProductionRunFixture('return');
  foreign = await createProductionRunFixture('return-foreign');
  actorId = `return-actor-${crypto.randomUUID()}`;
  await db.insert(users).values({ id: actorId, name: 'Return test actor', email: `${actorId}@example.test` });
  fixture.ctx.userId = actorId;
  binId = await taggedBin();
  secondBinId = await taggedBin();
  const [intake] = await db.insert(feedstocks).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    supplierId: fixture.supplierId, storageLocationId: fixture.binId, feedstockTypeId: fixture.feedstockTypeId, code: 'RETURN-INTAKE',
    deliveryDate: new Date('2026-01-01T00:00:00Z'), status: 'complete', massWetKg: CONSUMED_WET_KG, massDryKg: 50, moistureContentPercent: 50 }).returning();
  intakeId = intake.id;
  const [run] = await db.insert(productionRuns).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    reactorId: fixture.reactorId, code: 'RETURN-RUN', status: 'failed', startTime: new Date('2026-01-02T09:00:00Z'),
    endTime: new Date('2026-01-02T10:00:00Z'), feedstockWetMassKg: CONSUMED_WET_KG, feedstockMoisturePercent: 20, feedstockMassDryKg: CONSUMED_DRY_KG }).returning();
  runId = run.id;
  await db.insert(productionRunFeedstockDraws).values({ organizationId: fixture.ctx.organizationId, productionRunId: runId, storageLocationId: fixture.binId, wetMassKg: CONSUMED_WET_KG });
  await db.insert(productionRunFeedstocks).values({ organizationId: fixture.ctx.organizationId, productionRunId: runId, feedstockId: intakeId, wetMassUsedKg: CONSUMED_WET_KG });
}, TIMEOUT_MS);
afterEach(async () => {
  if (fixture) {
    await db.delete(binMovements).where(eq(binMovements.organizationId, fixture.ctx.organizationId));
    await removeIntakeFixture(fixture);
  }
  if (foreign) await removeIntakeFixture(foreign);
  if (actorId) await db.delete(users).where(eq(users.id, actorId));
}, TIMEOUT_MS);

describe('failed-run return writer and ledger', { timeout: TIMEOUT_MS }, () => {
  it('adds stock to an empty tagged bin with frozen provenance and matching aggregate/timeline', async () => {
    const saved = await recordProductionRunReturn(fixture.ctx, input({ wetMassKg: 160, moisturePercent: 50 }));
    expect(saved).toMatchObject({ createdBy: actorId, massDeltaKg: 160, feedstockDryDeltaKg: 80, sourceProductionRunId: runId });
    expect(saved.inputSnapshot).toMatchObject({ actorId, sourceRunVersion: 1, consumedDryKg: 80,
      allocations: [expect.objectContaining({ feedstockId: intakeId, wetMassKg: 100 })] });
    const timeline = await replayFeedstockBinStock(fixture.ctx, binId);
    expect(timeline).toMatchObject({ currentWetKg: 160, remainingDryKg: 80,
      batches: [expect.objectContaining({ id: saved.id, kind: 'failed_run_return', sourceProductionRunId: runId })],
      entries: [expect.objectContaining({ kind: 'failed_run_return', sourceId: runId })] });
    expect((await deriveLaneStock(fixture.ctx, db, { storageLocationIds: [binId], lanes: 'feedstock' }))[0])
      .toMatchObject({ feedstockStockWetKg: 160, feedstockEstimatedDryKg: 80 });
    expect(await db.select().from(feedstocks).where(eq(feedstocks.organizationId, fixture.ctx.organizationId))).toHaveLength(1);
  });

  it('allows several destinations up to the exact shared cap, using run moisture rather than intake moisture', async () => {
    await recordProductionRunReturn(fixture.ctx, input());
    await recordProductionRunReturn(fixture.ctx, input({ storageLocationId: secondBinId }));
    await expect(recordProductionRunReturn(fixture.ctx, input({ wetMassKg: 0.001, moisturePercent: 0 }))).rejects.toThrow('exceeds');
    expect(await getProductionRunReturnHistory(fixture.ctx, runId)).toHaveLength(2);
  });

  it('keeps returns as distinct holdings through loss and count replay, without allowing count top-ups', async () => {
    const first = await recordProductionRunReturn(fixture.ctx, input());
    const second = await recordProductionRunReturn(fixture.ctx, input({ wetMassKg: 80, moisturePercent: 50, occurredAt: '2026-01-02T13:00:00Z' }));
    await createBinMovement(fixture.ctx, { storageLocationId: binId, lane: 'feedstock', movementType: 'loss', massDeltaKg: -25,
      occurredAt: new Date('2026-01-02T14:00:00Z'), reason: 'Measured spill', idempotencyKey: crypto.randomUUID() });
    const afterLoss = await replayFeedstockBinStock(fixture.ctx, binId);
    expect(afterLoss.batches.map(row => row.id)).toEqual([first.id, second.id]);
    expect(afterLoss.remainingDryKg).toBe(60);
    await expect(recordStockTakeMovement(fixture.ctx, { storageLocationId: binId, lane: 'feedstock', reason: 'Count',
      countedMassKg: 106, countedWetMassKg: 106, moistureRatioUsed: 0.2 })).rejects.toThrow('cannot exceed');
    await recordStockTakeMovement(fixture.ctx, { storageLocationId: binId, lane: 'feedstock', reason: 'Count',
      countedMassKg: 80, countedWetMassKg: 80, moistureRatioUsed: 0.2 });
    const afterCount = await replayFeedstockBinStock(fixture.ctx, binId);
    expect(afterCount.currentWetKg).toBe(80);
    expect(afterCount.remainingDryKg).toBe(40);
    expect((await deriveLaneStock(fixture.ctx, db, { storageLocationIds: [binId], lanes: 'feedstock' }))[0].feedstockEstimatedDryKg).toBe(40);
  });

  it('replays the same key before mutable eligibility and captures only the first posting', async () => {
    const draft = input();
    const capture = vi.fn();
    const saved = await db.transaction(tx => recordProductionRunReturnInTransaction(fixture.ctx, tx, draft, { capture }));
    await db.update(storageLocations).set({ archivedAt: new Date() }).where(eq(storageLocations.id, binId));
    const replay = await db.transaction(tx => recordProductionRunReturnInTransaction(fixture.ctx, tx, draft, { capture }));
    expect(replay.id).toBe(saved.id);
    expect(capture).toHaveBeenCalledTimes(1);
    const conflict = recordProductionRunReturn(fixture.ctx, { ...draft, reason: 'Different' });
    await expect(conflict).rejects.toBeInstanceOf(ActionConflictError);
    const [bin] = await db.select().from(storageLocations).where(eq(storageLocations.id, binId));
    await expect(conflict).rejects.toMatchObject({ conflict: {
      entity: STOCK_CONFLICT_ENTITY.storageLocation, id: binId, code: bin.code,
    } });
  });

  it.each(['running', 'complete', 'cancelled'] as const)('refuses %s runs', async status => {
    await db.update(productionRuns).set({ status, cancellationReason: status === 'cancelled' ? 'Test cancellation' : null,
      ...(status === 'complete' ? { biocharOutputKg: 1, biocharMoisturePercent: 0, biocharDryMassKg: 1, biocharStorageLocationId: fixture.binId, outputPostedAt: new Date() } : {}) }).where(eq(productionRuns.id, runId));
    await expect(recordProductionRunReturn(fixture.ctx, input())).rejects.toThrow('Failed');
  });

  it.each(['untagged', 'untyped', 'wrong-type', 'wrong-lane', 'archived', 'wrong-facility'] as const)('refuses %s destinations', async mode => {
    const [otherType] = await db.insert(feedstockTypes).values({ organizationId: fixture.ctx.organizationId, code: 'RETURN-OTHER', name: 'Other', category: 'forestry', usage: 'pyrolysis' }).returning();
    const patch = mode === 'untagged' ? { uncarbonized: false } : mode === 'untyped' ? { feedstockTypeId: null }
      : mode === 'wrong-type' ? { feedstockTypeId: otherType.id } : mode === 'wrong-lane' ? { type: 'biochar_bin' as const, uncarbonized: false }
        : mode === 'archived' ? { archivedAt: new Date() } : { facilityId: foreign.facilityId };
    if (mode === 'wrong-facility') {
      const [other] = await db.select().from(facilities).where(eq(facilities.id, foreign.facilityId));
      const [otherFacility] = await db.insert(facilities).values({ ...other, id: crypto.randomUUID(), organizationId: fixture.ctx.organizationId, code: 'RETURN-OTHER-FAC' }).returning();
      await db.update(storageLocations).set({ facilityId: otherFacility.id }).where(eq(storageLocations.id, binId));
      await expect(recordProductionRunReturn(fixture.ctx, input())).rejects.toThrow('same type and facility');
    } else {
      await db.update(storageLocations).set(patch).where(eq(storageLocations.id, binId));
      await expect(recordProductionRunReturn(fixture.ctx, input())).rejects.toThrow();
    }
  });

  it('refuses foreign source reads, missing moisture and unresolved consumption', async () => {
    expect(await getProductionRunReturnHistory(foreign.ctx, runId)).toEqual([]);
    await expect(recordProductionRunReturn(fixture.ctx, input({ storageLocationId: foreign.binId }))).rejects.toThrow('same type and facility');
    await expect(recordProductionRunReturn(foreign.ctx, input())).rejects.toThrow('not found');
    await db.update(productionRuns).set({ feedstockMoisturePercent: null }).where(eq(productionRuns.id, runId));
    await expect(recordProductionRunReturn(fixture.ctx, input())).rejects.toThrow('moisture');
    await db.update(productionRuns).set({ feedstockMoisturePercent: 20 }).where(eq(productionRuns.id, runId));
    await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, runId));
    await expect(recordProductionRunReturn(fixture.ctx, input())).rejects.toThrow('consumption');
  });

  it('atomically moves a corrected return, restores allowance and refuses repeated correction', async () => {
    const original = await recordProductionRunReturn(fixture.ctx, input());
    const request = correction(original.id, input({ storageLocationId: secondBinId, wetMassKg: 100, moisturePercent: 20 }));
    const reversed = await correctProductionRunReturn(fixture.ctx, request);
    expect(reversed).toMatchObject({ massDeltaKg: -50, feedstockDryDeltaKg: -40, moistureRatioUsed: 0.2 });
    expect((await correctProductionRunReturn(fixture.ctx, request)).id).toBe(reversed.id);
    await expect(correctProductionRunReturn(fixture.ctx, correction(original.id))).rejects.toThrow('already');
    expect((await getFeedstockBinStock(fixture.ctx, binId)).currentWetKg).toBe(0);
    expect((await getFeedstockBinStock(fixture.ctx, secondBinId)).currentWetKg).toBe(100);
    expect((await getFeedstockBinStock(fixture.ctx, binId)).entries[0]).toMatchObject({ reversed: true, reversedBy: { replacementId: expect.any(String) } });
    expect(await getProductionRunReturnHistory(fixture.ctx, runId)).toHaveLength(3);
  });

  it('rolls back the reversal when a replacement exceeds the cap', async () => {
    const original = await recordProductionRunReturn(fixture.ctx, input());
    await expect(correctProductionRunReturn(fixture.ctx, correction(original.id, input({ wetMassKg: 101 })))).rejects.toThrow('exceeds');
    expect(await getProductionRunReturnHistory(fixture.ctx, runId)).toHaveLength(1);
    expect((await getFeedstockBinStock(fixture.ctx, binId)).currentWetKg).toBe(50);
  });

  it.each(['loss', 'count'] as const)('allows reversal after an unrelated addition but refuses it after a later %s', async kind => {
    const original = await recordProductionRunReturn(fixture.ctx, input());
    await recordProductionRunReturn(fixture.ctx, input({ occurredAt: '2026-01-02T13:00:00Z' }));
    await correctProductionRunReturn(fixture.ctx, correction(original.id));
    const active = (await getProductionRunReturnHistory(fixture.ctx, runId)).find(row => row.movementType === 'failed_run_return' && row.id !== original.id)!;
    if (kind === 'count') await recordStockTakeMovement(fixture.ctx, { storageLocationId: binId, lane: 'feedstock', reason: 'Confirmed count', countedMassKg: 50, countedWetMassKg: 50, moistureRatioUsed: 0.2 });
    else await createBinMovement(fixture.ctx, { storageLocationId: binId, lane: 'feedstock', movementType: 'loss', massDeltaKg: -1,
      occurredAt: new Date('2026-01-02T14:00:00Z'), reason: 'Measured spill', idempotencyKey: crypto.randomUUID() });
    await expect(correctProductionRunReturn(fixture.ctx, correction(active.id))).rejects.toMatchObject({ code: 'certification_locked' });
  });

  it('refuses mixed types while allowing multiple allocations of one type', async () => {
    const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.id, intakeId));
    const [second] = await db.insert(feedstocks).values({ ...intake, id: crypto.randomUUID(), code: 'RETURN-SECOND', massWetKg: 50, massDryKg: 25 }).returning();
    await db.update(productionRunFeedstocks).set({ wetMassUsedKg: 50 }).where(eq(productionRunFeedstocks.productionRunId, runId));
    await db.insert(productionRunFeedstocks).values({ organizationId: fixture.ctx.organizationId, productionRunId: runId, feedstockId: second.id, wetMassUsedKg: 50 });
    const original = await recordProductionRunReturn(fixture.ctx, input());
    expect(original.inputSnapshot?.allocations).toHaveLength(2);
    const [other] = await db.insert(feedstockTypes).values({ organizationId: fixture.ctx.organizationId, code: 'MIXED', name: 'Other type', category: 'forestry', usage: 'pyrolysis' }).returning();
    await db.update(feedstocks).set({ feedstockTypeId: other.id }).where(eq(feedstocks.id, second.id));
    await expect(recordProductionRunReturn(fixture.ctx, input())).rejects.toThrow('mixed');
  });

  it('refuses times before run end and in the future', async () => {
    for (const occurredAt of ['2026-01-02T09:00:00Z', '2099-01-02T12:00:00Z']) {
      await expect(recordProductionRunReturn(fixture.ctx, input({ occurredAt }))).rejects.toThrow('return time');
    }
    expect(await getProductionRunReturnHistory(fixture.ctx, runId)).toHaveLength(0);
  });

  it('rolls back stock and capture together when the caller transaction fails', async () => {
    await expect(db.transaction(async tx => {
      await recordProductionRunReturnInTransaction(fixture.ctx, tx, input(), { capture: () => { throw new Error('Capture failed'); } });
    })).rejects.toThrow('Capture failed');
    expect(await getProductionRunReturnHistory(fixture.ctx, runId)).toHaveLength(0);
    expect((await getFeedstockBinStock(fixture.ctx, binId)).currentWetKg).toBe(0);
  });

  it('protects return references, signs, required basis and correction uniqueness in the database', async () => {
    const original = await recordProductionRunReturn(fixture.ctx, input());
    const base = { ...original, id: undefined, postingSequence: undefined };
    const invalid = [
      { lane: 'biochar' as const }, { massDeltaKg: -1 }, { feedstockDryDeltaKg: 0 },
      { feedstockDryDeltaKg: null }, { sourceProductionRunId: null }, { returnedFeedstockTypeId: null },
      { occurredAt: null }, { moistureRatioUsed: null }, { moistureRatioUsed: 1 },
      { inputSnapshot: null }, { inputSnapshot: {} }, { reason: ' ' }, { idempotencyKey: null },
      { movementType: 'failed_run_return_reversal' as const, massDeltaKg: -50, feedstockDryDeltaKg: -40, correctsMovementId: null },
    ];
    for (const patch of invalid) {
      await expect(db.insert(binMovements).values({ ...base, idempotencyKey: crypto.randomUUID(), ...patch }))
        .rejects.toMatchObject({ cause: { code: '23514' } });
    }
    await expect(db.insert(binMovements).values({ ...base, idempotencyKey: crypto.randomUUID(), returnedFeedstockTypeId: foreign.feedstockTypeId }))
      .rejects.toMatchObject({ cause: { code: '23503' } });
    const [foreignRun] = await db.insert(productionRuns).values({ organizationId: foreign.ctx.organizationId, facilityId: foreign.facilityId,
      reactorId: foreign.reactorId, code: 'FOREIGN-RETURN', startTime: new Date('2026-01-02T09:00:00Z') }).returning();
    await expect(db.insert(binMovements).values({ ...base, idempotencyKey: crypto.randomUUID(), sourceProductionRunId: foreignRun.id }))
      .rejects.toMatchObject({ cause: { code: '23503' } });
    const reversal = await correctProductionRunReturn(fixture.ctx, correction(original.id));
    await expect(db.insert(binMovements).values({ ...base, ...reversal, id: crypto.randomUUID(), postingSequence: undefined, idempotencyKey: crypto.randomUUID() }))
      .rejects.toMatchObject({ cause: { code: '23505', constraint: 'bin_movements_one_return_reversal' } });
    await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, runId));
    await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, runId));
    await expect(db.delete(productionRuns).where(eq(productionRuns.id, runId))).rejects.toMatchObject({ cause: { code: '23001' } });
  });

  it('serializes two returns to different bins racing for the same remaining dry allowance', async () => {
    const pool = createTestPool(2);
    const barrier = await openOperationBarrier(pool);
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await barrier.tx.select().from(productionRuns).where(and(eq(productionRuns.organizationId, fixture.ctx.organizationId), eq(productionRuns.id, runId))).for('update');
      pending = Promise.allSettled([
        recordProductionRunReturn(fixture.ctx, input({ wetMassKg: 75 })),
        recordProductionRunReturn(fixture.ctx, input({ storageLocationId: secondBinId, wetMassKg: 75 })),
      ]);
      await waitForBlockedOperations(pool, barrier.pid, 2);
      await barrier.commit();
      const results = await pending;
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      const history = await getProductionRunReturnHistory(fixture.ctx, runId);
      expect(history).toHaveLength(1);
      expect(history[0].feedstockDryDeltaKg).toBe(60);
    } finally {
      await barrier.rollback();
      await pending;
      await pool.end();
    }
  });
});
