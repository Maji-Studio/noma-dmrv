import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { activityEvents, binMovements, feedstocks, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, storageLocations, users } from '@/db/schema';
import { recordProductionRunReturn, correctProductionRunReturn } from '@/lib/operations/production-run-returns';
import { runOperationInProcess } from '@/lib/operations/runner';
import { operationRegistry } from '@/lib/operations/registry';
import { getProductionRunReturnEligibility } from '@/data-access/production-run-returns/eligibility';
import { getProductionRunReturnHistory } from '@/data-access/production-run-returns';
import type { RecordProductionRunReturnInput } from '@/schemas/production-run-returns';
import { createProductionRunFixture, removeIntakeFixture } from './helpers/operation-fixture';

const TIMEOUT_MS = 30_000;
const CONSUMED_WET_KG = 100;
const CONSUMED_DRY_KG = 80;
let fixture: Awaited<ReturnType<typeof createProductionRunFixture>>;
let foreign: Awaited<ReturnType<typeof createProductionRunFixture>>;
let input: RecordProductionRunReturnInput;
let actorId: string;

beforeEach(async () => {
  fixture = await createProductionRunFixture(`return-operation-${crypto.randomUUID()}`);
  foreign = await createProductionRunFixture(`return-operation-foreign-${crypto.randomUUID()}`);
  actorId = `return-operation-${crypto.randomUUID()}`;
  await db.insert(users).values({ id: actorId, name: 'Test actor', email: `${actorId}@example.test` });
  fixture.ctx.userId = actorId;
  const [destination] = await db.insert(storageLocations).values({ organizationId: fixture.ctx.organizationId,
    facilityId: fixture.facilityId, code: `RETURN-${crypto.randomUUID()}`, name: `Returned material ${crypto.randomUUID()}`, type: 'feedstock_bin',
    uncarbonized: true, feedstockTypeId: fixture.feedstockTypeId }).returning();
  const [intake] = await db.insert(feedstocks).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    supplierId: fixture.supplierId, storageLocationId: fixture.binId, feedstockTypeId: fixture.feedstockTypeId, code: `RETURN-INTAKE-${crypto.randomUUID()}`,
    deliveryDate: new Date('2026-01-01T00:00:00Z'), status: 'complete', massWetKg: CONSUMED_WET_KG,
    massDryKg: CONSUMED_DRY_KG, moistureContentPercent: 20 }).returning();
  const [run] = await db.insert(productionRuns).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    reactorId: fixture.reactorId, code: `RETURN-RUN-${crypto.randomUUID()}`, status: 'failed', startTime: new Date('2026-01-02T09:00:00Z'),
    endTime: new Date('2026-01-02T10:00:00Z'), feedstockWetMassKg: CONSUMED_WET_KG,
    feedstockMoisturePercent: 20, feedstockMassDryKg: CONSUMED_DRY_KG }).returning();
  await db.insert(productionRunFeedstockDraws).values({ organizationId: fixture.ctx.organizationId, productionRunId: run.id,
    storageLocationId: fixture.binId, wetMassKg: CONSUMED_WET_KG });
  await db.insert(productionRunFeedstocks).values({ organizationId: fixture.ctx.organizationId,
    productionRunId: run.id, feedstockId: intake.id, wetMassUsedKg: CONSUMED_WET_KG });
  input = { sourceProductionRunId: run.id, storageLocationId: destination.id, wetMassKg: 50,
    moisturePercent: 20, occurredAt: '2026-01-02T12:00:00Z', reason: 'Returned failed material', idempotencyKey: crypto.randomUUID() };
}, TIMEOUT_MS);

afterEach(async () => {
  if (fixture) {
    await db.delete(binMovements).where(eq(binMovements.organizationId, fixture.ctx.organizationId));
    await removeIntakeFixture(fixture);
  }
  if (foreign) await removeIntakeFixture(foreign);
  if (actorId) await db.delete(users).where(eq(users.id, actorId));
}, TIMEOUT_MS);

async function activities() {
  return db.select().from(activityEvents).where(eq(activityEvents.organizationId, fixture.ctx.organizationId));
}

describe('app-only failed-run return operations', { timeout: TIMEOUT_MS }, () => {
  it('keeps return commands outside the public operation allowlist', () => {
    expect(operationRegistry).not.toHaveProperty(recordProductionRunReturn.id);
    expect(operationRegistry).not.toHaveProperty(correctProductionRunReturn.id);
  });

  it('attributes one source-run activity to the authenticated actor and suppresses replay activity', async () => {
    const saved = await runOperationInProcess(recordProductionRunReturn, fixture.ctx, input);
    expect(saved.createdBy).toBe(actorId);
    expect(typeof saved.postingSequence).toBe('string');
    expect(() => JSON.stringify(saved)).not.toThrow();
    expect(saved).toMatchObject({ massDeltaKg: 50, feedstockDryDeltaKg: 40 });
    const replay = await runOperationInProcess(recordProductionRunReturn, fixture.ctx, input);
    expect(replay).toEqual(saved);
    expect(() => JSON.stringify(replay)).not.toThrow();
    expect(await activities()).toMatchObject([{ entityType: 'production_run', entityId: input.sourceProductionRunId,
      productionRunId: input.sourceProductionRunId, facilityId: fixture.facilityId,
      actorUserId: actorId, operationId: 'record_production_run_return', source: 'form', changes: {
        returnedMovementId: { from: null, to: saved.id },
        returnedStorageLocationId: { from: null, to: input.storageLocationId },
        returnedWetMassKg: { from: null, to: 50 }, returnedDryMassKg: { from: null, to: 40 },
        returnedMoistureRatio: { from: null, to: 0.2 },
      } }]);
    expect(await getProductionRunReturnHistory(fixture.ctx, input.sourceProductionRunId)).toHaveLength(1);
  });

  it('records one activity for an atomic reversal and replacement, and none for its replay', async () => {
    const original = await runOperationInProcess(recordProductionRunReturn, fixture.ctx, input);
    const correction = { sourceProductionRunId: input.sourceProductionRunId, storageLocationId: input.storageLocationId,
      correctsMovementId: original.id, reason: 'Correct measurement', idempotencyKey: crypto.randomUUID(),
      replacement: { ...input, wetMassKg: 60 } };
    const reversal = await runOperationInProcess(correctProductionRunReturn, fixture.ctx, correction);
    const replay = await runOperationInProcess(correctProductionRunReturn, fixture.ctx, correction);
    expect(typeof reversal.postingSequence).toBe('string');
    expect(reversal).toMatchObject({ massDeltaKg: -50, feedstockDryDeltaKg: -40 });
    expect(replay).toEqual(reversal);
    expect(() => JSON.stringify({ reversal, replay })).not.toThrow();
    const events = await activities();
    expect(events).toHaveLength(2);
    const history = await getProductionRunReturnHistory(fixture.ctx, input.sourceProductionRunId);
    const replacement = history.find(row => row.movementType === 'failed_run_return' && row.id !== original.id)!;
    expect(events.find(event => event.operationId === 'correct_production_run_return')?.changes).toMatchObject({
      reversedMovementId: { from: null, to: reversal.id }, reversedCorrectsMovementId: { from: null, to: original.id },
      reversedStorageLocationId: { from: null, to: input.storageLocationId },
      reversedWetMassKg: { from: null, to: -50 }, reversedDryMassKg: { from: null, to: -40 },
      reversedMoistureRatio: { from: null, to: 0.2 },
      replacementMovementId: { from: null, to: replacement.id },
      replacementStorageLocationId: { from: null, to: input.storageLocationId },
      replacementWetMassKg: { from: null, to: 60 }, replacementDryMassKg: { from: null, to: 48 },
      replacementMoistureRatio: { from: null, to: 0.2 },
    });
    expect(await getProductionRunReturnHistory(fixture.ctx, input.sourceProductionRunId)).toHaveLength(3);
    expect(await getProductionRunReturnEligibility(fixture.ctx, input.sourceProductionRunId)).toMatchObject({
      eligible: true, consumedDryKg: 80, returnedDryKg: 48, remainingDryKg: 32,
    });
  });

  it('rejects missing authorization and foreign references without recording activity', async () => {
    await expect(runOperationInProcess(recordProductionRunReturn, { ...fixture.ctx, userId: '' }, input)).rejects.toThrow();
    await expect(runOperationInProcess(recordProductionRunReturn, foreign.ctx, input)).rejects.toThrow();
    await expect(getProductionRunReturnEligibility(foreign.ctx, input.sourceProductionRunId)).rejects.toThrow();
    expect(await getProductionRunReturnHistory(foreign.ctx, input.sourceProductionRunId)).toEqual([]);
    expect(await activities()).toHaveLength(0);
  });

  it('rolls back both the posting and activity if the runner cannot finish the operation', async () => {
    const failed: typeof recordProductionRunReturn = {
      ...recordProductionRunReturn,
      execute: async (scope, parsed) => {
        await recordProductionRunReturn.execute(scope, parsed);
        throw new Error('Abort after writer capture');
      },
    };
    await expect(runOperationInProcess(failed, fixture.ctx, input)).rejects.toThrow('Abort after writer capture');
    expect(await activities()).toHaveLength(0);
    expect(await getProductionRunReturnHistory(fixture.ctx, input.sourceProductionRunId)).toHaveLength(0);
    await runOperationInProcess(recordProductionRunReturn, fixture.ctx, input);
    expect(await activities()).toHaveLength(1);
  });
});
