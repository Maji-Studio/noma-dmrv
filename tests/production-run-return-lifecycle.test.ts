/** Database lifecycle contracts. Executed by the caller after sandbox review. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, facilities, reactors, feedstocks, feedstockTypes, productionRunFeedstocks, productionRunFeedstockDraws, productionRuns, storageLocations, users } from '@/db/schema';
import { recordProductionRunReturn, correctProductionRunReturn, getProductionRunReturnHistory } from '@/data-access/production-run-returns';
import { runOperation } from '@/lib/operations/runner';
import { updateProductionRun as updateRunOperation, deleteProductionRun as deleteRunOperation } from '@/lib/operations/production-runs';
import { updateProductionRun } from '@/data-access/production-runs/mutations';
import { deleteProductionRun } from '@/data-access/production-runs/delete';
import { readRecordDependents } from '@/data-access/record-lock-dependents';
import { reallocateRunsForBins } from '@/data-access/feedstock-run-allocations';
import { updateStorageLocation } from '@/data-access/storage-locations';
import { createProductionRunFixture, createTestPool, removeIntakeFixture } from './helpers/operation-fixture';
import { openOperationBarrier, waitForBlockedOperations } from './helpers/operation-barrier';
import type { RecordProductionRunReturnInput } from '@/schemas/production-run-returns';

const TIMEOUT_MS = 30_000;
const CONSUMED_WET_KG = 100;
const CONSUMED_DRY_KG = 80;
const RETURN_AT = '2026-01-02T12:00:00.000Z';
let fixture: Awaited<ReturnType<typeof createProductionRunFixture>>;
let runId: string;
let binId: string;
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
  fixture = await createProductionRunFixture(`return-${crypto.randomUUID()}`);
  actorId = `return-actor-${crypto.randomUUID()}`;
  await db.insert(users).values({ id: actorId, name: 'Return test actor', email: `${actorId}@example.test` });
  fixture.ctx.userId = actorId;
  binId = await taggedBin();
  const [intake] = await db.insert(feedstocks).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    supplierId: fixture.supplierId, storageLocationId: fixture.binId, feedstockTypeId: fixture.feedstockTypeId, code: `RETURN-INTAKE-${crypto.randomUUID()}`,
    deliveryDate: new Date('2026-01-01T00:00:00Z'), status: 'complete', massWetKg: CONSUMED_WET_KG, massDryKg: 50, moistureContentPercent: 50 }).returning();
  intakeId = intake.id;
  const [run] = await db.insert(productionRuns).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    reactorId: fixture.reactorId, code: `RETURN-RUN-${crypto.randomUUID()}`, status: 'failed', startTime: new Date('2026-01-02T09:00:00Z'),
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
  if (actorId) await db.delete(users).where(eq(users.id, actorId));
}, TIMEOUT_MS);


const MUTATION_CASES = ['reopen', 'draw edit', 'moisture edit', 'deletion'] as const;
function mutate(kind: typeof MUTATION_CASES[number]) {
  if (kind === 'deletion') return deleteProductionRun(fixture.ctx, runId, 1);
  const patch = kind === 'reopen' ? { status: 'running' as const, endTime: null }
    : kind === 'draw edit' ? { feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: 40 }] }
      : { feedstockMoisturePercent: 90 };
  return updateProductionRun(fixture.ctx, runId, { expectedVersion: 1, ...patch });
}

describe('return source lifecycle', { timeout: TIMEOUT_MS }, () => {
  it('refuses moving facilities when source draws are resubmitted unchanged', async () => {
    const tag = crypto.randomUUID();
    const [facility] = await db.select().from(facilities).where(eq(facilities.id, fixture.facilityId));
    const [reactor] = await db.select().from(reactors).where(eq(reactors.id, fixture.reactorId));
    const [destination] = await db.insert(facilities).values({ ...facility, id: crypto.randomUUID(),
      code: `MOVE-${tag}`, name: `Move destination ${tag}` }).returning();
    const [destinationReactor] = await db.insert(reactors).values({ ...reactor, id: crypto.randomUUID(),
      facilityId: destination.id, code: `MOVE-${tag}`, identifier: `Move reactor ${tag}` }).returning();
    await expect(updateProductionRun(fixture.ctx, runId, { expectedVersion: 1,
      facilityId: destination.id, reactorId: destinationReactor.id,
      feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: CONSUMED_WET_KG }],
    })).rejects.toThrow('Feedstock bin does not belong to the selected facility');
    const [unchanged] = await db.select().from(productionRuns).where(eq(productionRuns.id, runId));
    expect(unchanged).toMatchObject({ facilityId: fixture.facilityId, version: 1 });
  });

  it('refuses reopening a failed run against an archived source with unchanged draws', async () => {
    await db.update(storageLocations).set({ archivedAt: new Date() }).where(eq(storageLocations.id, fixture.binId));
    await expect(updateProductionRun(fixture.ctx, runId, { expectedVersion: 1, status: 'running', endTime: null,
      feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: CONSUMED_WET_KG }],
    })).rejects.toThrow('Storage bin was not found or is archived.');
    const [unchanged] = await db.select().from(productionRuns).where(eq(productionRuns.id, runId));
    expect(unchanged).toMatchObject({ status: 'failed', version: 1 });
  });

  it('marks retained return history as an in-use refusal without changing its code', async () => {
    const original = await recordProductionRunReturn(fixture.ctx, input());
    await correctProductionRunReturn(fixture.ctx, correction(original.id));
    await expect(deleteProductionRun(fixture.ctx, runId, 1)).rejects.toMatchObject({
      code: 'certification_locked', issues: [{ path: ['productionRunId'], code: 'certification_locked', meta: { reason: 'in_use' } }],
    });
  });

  it.each(MUTATION_CASES)('refuses %s after a return', async kind => {
    await recordProductionRunReturn(fixture.ctx, input());
    await expect(mutate(kind)).rejects.toMatchObject({ code: 'certification_locked' });
  });

  it('blocks cancellation and run time changes but accepts unrelated fields and unchanged draws', async () => {
    await recordProductionRunReturn(fixture.ctx, input());
    for (const patch of [{ status: 'cancelled' as const, cancellationReason: 'Cancelled' },
      { endTime: new Date('2026-01-02T11:00:00Z') }, { startTime: new Date('2026-01-02T08:00:00Z') }]) {
      await expect(updateProductionRun(fixture.ctx, runId, { expectedVersion: 1, ...patch })).rejects.toMatchObject({ code: 'certification_locked' });
    }
    const original = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, runId));
    await expect(updateProductionRun(fixture.ctx, runId, { expectedVersion: 1, feedingRateKgHr: 10,
      feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: CONSUMED_WET_KG }], feedstockMoisturePercent: 20 })).resolves.toMatchObject({ feedingRateKgHr: 10 });
    expect(await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, runId))).toEqual(original);
  });

  it('refuses valid same-organization facility and reactor changes while returns are active', async () => {
    await recordProductionRunReturn(fixture.ctx, input());
    const [sourceFacility] = await db.select().from(facilities).where(eq(facilities.id, fixture.facilityId));
    const [sourceReactor] = await db.select().from(reactors).where(eq(reactors.id, fixture.reactorId));
    const [otherFacility] = await db.insert(facilities).values({ ...sourceFacility, id: crypto.randomUUID(), code: `RETURN-OTHER-FACILITY-${crypto.randomUUID()}`, name: `Return other facility ${crypto.randomUUID()}` }).returning();
    const [sameFacilityReactor] = await db.insert(reactors).values({ ...sourceReactor, id: crypto.randomUUID(), code: `RETURN-OTHER-REACTOR-${crypto.randomUUID()}`, identifier: `Return other reactor ${crypto.randomUUID()}` }).returning();
    const [otherFacilityReactor] = await db.insert(reactors).values({ ...sourceReactor, id: crypto.randomUUID(), code: `RETURN-MOVED-REACTOR-${crypto.randomUUID()}`, identifier: `Moved reactor ${crypto.randomUUID()}`, facilityId: otherFacility.id }).returning();
    for (const patch of [{ reactorId: sameFacilityReactor.id }, { facilityId: otherFacility.id, reactorId: otherFacilityReactor.id }]) {
      await expect(updateProductionRun(fixture.ctx, runId, { expectedVersion: 1, ...patch })).rejects.toMatchObject({ code: 'certification_locked' });
    }
  });

  it('enforces the same return guards through the shared REST and MCP update and delete operations', async () => {
    await recordProductionRunReturn(fixture.ctx, input());
    const target = { productionRunId: runId, expectedVersion: 1 };
    for (const transport of ['rest', 'mcp'] as const) {
      const options = { audit: { transport, requestId: crypto.randomUUID(), credentialId: 'return-lifecycle-test' } };
      await expect(runOperation(updateRunOperation, fixture.ctx, { ...target, status: 'running', endTime: null }, options))
        .rejects.toMatchObject({ code: 'certification_locked' });
      await expect(runOperation(updateRunOperation, fixture.ctx, { ...target, feedstockMoisturePercent: 90 }, options))
        .rejects.toMatchObject({ code: 'certification_locked' });
      await expect(runOperation(deleteRunOperation, fixture.ctx, target, options))
        .rejects.toMatchObject({ code: 'certification_locked' });
    }
  });

  it('releases active dependencies after reversal while retaining the deletion refusal and frozen evidence', async () => {
    const original = await recordProductionRunReturn(fixture.ctx, input());
    expect(await readRecordDependents(fixture.ctx, db, { entityType: 'productionRun', entityId: runId }))
      .toContainEqual(expect.objectContaining({ id: original.id, failedRunReturn: true }));
    await correctProductionRunReturn(fixture.ctx, correction(original.id));
    expect(await readRecordDependents(fixture.ctx, db, { entityType: 'productionRun', entityId: runId })).toEqual([]);
    await expect(deleteProductionRun(fixture.ctx, runId, 1)).rejects.toMatchObject({ code: 'certification_locked' });
    await expect(mutate('reopen')).resolves.toMatchObject({ status: 'running', version: 2 });
    await expect(updateProductionRun(fixture.ctx, runId, { expectedVersion: 2, status: 'cancelled', cancellationReason: 'Return reversed before cancelling' }))
      .resolves.toMatchObject({ status: 'cancelled' });
    const history = await getProductionRunReturnHistory(fixture.ctx, runId);
    expect(history).toHaveLength(2);
    expect(history[0].inputSnapshot).toEqual(original.inputSnapshot);
  });

  it('allows unchanged allocation replay and refuses an indirect rewrite atomically', async () => {
    await recordProductionRunReturn(fixture.ctx, input());
    const before = await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, runId));
    await expect(db.transaction(tx => reallocateRunsForBins(fixture.ctx, tx, [fixture.binId]))).resolves.toEqual([]);
    await expect(db.transaction(async tx => {
      const [replacement] = await tx.insert(feedstocks).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
        supplierId: fixture.supplierId, storageLocationId: fixture.binId, feedstockTypeId: fixture.feedstockTypeId, code: 'EARLIER-INTAKE',
        deliveryDate: new Date('2025-12-31T00:00:00Z'), status: 'complete', massWetKg: CONSUMED_WET_KG, massDryKg: 50, moistureContentPercent: 50 }).returning();
      expect(replacement.id).not.toBe(intakeId);
      await reallocateRunsForBins(fixture.ctx, tx, [fixture.binId]);
    })).rejects.toMatchObject({ code: 'certification_locked' });
    expect(await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, runId))).toEqual(before);
    expect(await db.select().from(feedstocks).where(eq(feedstocks.organizationId, fixture.ctx.organizationId))).toHaveLength(1);
  });

  it('retains bin tag and lane identity even after every return is reversed', async () => {
    const original = await recordProductionRunReturn(fixture.ctx, input());
    await correctProductionRunReturn(fixture.ctx, correction(original.id));
    const [otherType] = await db.insert(feedstockTypes).values({ organizationId: fixture.ctx.organizationId, code: 'OTHER-RETURN-TYPE', name: 'Other type', category: 'forestry', usage: 'pyrolysis' }).returning();
    for (const patch of [{ uncarbonized: false }, { type: 'biochar_bin' as const }, { feedstockTypeId: otherType.id }]) {
      await expect(updateStorageLocation(fixture.ctx, binId, { expectedVersion: 1, ...patch })).rejects.toMatchObject({ code: 'certification_locked' });
    }
  });

  it.each(MUTATION_CASES)('serializes return versus %s when the return locks first', async kind => {
    const pool = createTestPool(2);
    const barrier = await openOperationBarrier(pool);
    const pending: Promise<unknown>[] = [];
    try {
      await barrier.tx.select().from(productionRuns).where(and(eq(productionRuns.organizationId, fixture.ctx.organizationId), eq(productionRuns.id, runId))).for('update');
      pending.push(recordProductionRunReturn(fixture.ctx, input()));
      await waitForBlockedOperations(pool, barrier.pid, 1);
      pending.push(mutate(kind));
      await waitForBlockedOperations(pool, barrier.pid, 2);
      await barrier.commit();
      const [returned, mutation] = await Promise.allSettled(pending);
      expect(returned.status).toBe('fulfilled');
      expect(mutation).toMatchObject({ status: 'rejected', reason: { code: 'certification_locked' } });
      expect(await getProductionRunReturnHistory(fixture.ctx, runId)).toHaveLength(1);
    } finally {
      await barrier.rollback();
      await Promise.allSettled(pending);
      await pool.end();
    }
  });

  it.each(MUTATION_CASES)('rechecks the source when %s locks before the return', async kind => {
    const pool = createTestPool(2);
    const barrier = await openOperationBarrier(pool);
    const pending: Promise<unknown>[] = [];
    try {
      await barrier.tx.select().from(productionRuns).where(and(eq(productionRuns.organizationId, fixture.ctx.organizationId), eq(productionRuns.id, runId))).for('update');
      pending.push(mutate(kind));
      await waitForBlockedOperations(pool, barrier.pid, 1);
      pending.push(recordProductionRunReturn(fixture.ctx, input()));
      await waitForBlockedOperations(pool, barrier.pid, 2);
      await barrier.commit();
      const [mutation, returned] = await Promise.allSettled(pending);
      expect(mutation.status).toBe('fulfilled');
      expect(returned.status).toBe('rejected');
      expect(await getProductionRunReturnHistory(fixture.ctx, runId)).toEqual([]);
    } finally {
      await barrier.rollback();
      await Promise.allSettled(pending);
      await pool.end();
    }
  });
});
