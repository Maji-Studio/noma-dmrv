import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, feedstocks, productionRunFeedstocks, productionRunFeedstockDraws, productionRuns, storageLocations, users } from '@/db/schema';
import { recordProductionRunReturn, correctProductionRunReturn } from '@/data-access/production-run-returns';
import { getProductionRunMaterialBalance } from '@/data-access/production-run-material-balance';
import { createBinMovement } from '@/data-access/bin-movements';
import { createProductionRunFixture, removeIntakeFixture } from './helpers/operation-fixture';

const TIMEOUT_MS = 30_000;
const RETURN_AT = '2026-01-02T12:00:00Z';
let fixture: Awaited<ReturnType<typeof createProductionRunFixture>>;
let runId: string;
let binId: string;
let actorId: string;

beforeEach(async () => {
  fixture = await createProductionRunFixture('run-balance');
  actorId = `balance-actor-${crypto.randomUUID()}`;
  await db.insert(users).values({ id: actorId, name: 'Balance test actor', email: `${actorId}@example.test` });
  fixture.ctx.userId = actorId;
  const [bin] = await db.insert(storageLocations).values({ organizationId: fixture.ctx.organizationId,
    facilityId: fixture.facilityId, code: 'RETURN-BIN', name: 'Returned material', type: 'feedstock_bin',
    uncarbonized: true, feedstockTypeId: fixture.feedstockTypeId }).returning();
  binId = bin.id;
  const [intake] = await db.insert(feedstocks).values({ organizationId: fixture.ctx.organizationId,
    facilityId: fixture.facilityId, supplierId: fixture.supplierId, storageLocationId: fixture.binId,
    feedstockTypeId: fixture.feedstockTypeId, code: 'BALANCE-INTAKE', deliveryDate: new Date('2026-01-01T00:00:00Z'),
    status: 'complete', massWetKg: 100, massDryKg: 80, moistureContentPercent: 20 }).returning();
  const [run] = await db.insert(productionRuns).values({ organizationId: fixture.ctx.organizationId,
    facilityId: fixture.facilityId, reactorId: fixture.reactorId, code: 'BALANCE-RUN', status: 'failed',
    startTime: new Date('2026-01-02T09:00:00Z'), endTime: new Date('2026-01-02T10:00:00Z'),
    feedstockWetMassKg: 100, feedstockMoisturePercent: 20, feedstockMassDryKg: 80 }).returning();
  runId = run.id;
  await db.insert(productionRunFeedstockDraws).values({ organizationId: fixture.ctx.organizationId,
    productionRunId: runId, storageLocationId: fixture.binId, wetMassKg: 100 });
  await db.insert(productionRunFeedstocks).values({ organizationId: fixture.ctx.organizationId,
    productionRunId: runId, feedstockId: intake.id, wetMassUsedKg: 100 });
}, TIMEOUT_MS);

afterEach(async () => {
  if (fixture) {
    await db.delete(binMovements).where(eq(binMovements.organizationId, fixture.ctx.organizationId));
    await removeIntakeFixture(fixture);
  }
  if (actorId) await db.delete(users).where(eq(users.id, actorId));
}, TIMEOUT_MS);

function input(wetMassKg = 50) {
  return { sourceProductionRunId: runId, storageLocationId: binId, wetMassKg, moisturePercent: 20,
    occurredAt: RETURN_AT, reason: 'Failed material returned', idempotencyKey: crypto.randomUUID() };
}

describe('persisted run material balance', { timeout: TIMEOUT_MS }, () => {
  it('aggregates no, partial, multiple and fully corrected returns without double counting', async () => {
    expect((await getProductionRunMaterialBalance(fixture.ctx, runId)).balance)
      .toMatchObject({ consumedDryKg: 80, usableOutputDryKg: 0, activeReturnedDryKg: 0, conversionLossDryKg: 80 });
    const first = await recordProductionRunReturn(fixture.ctx, input());
    expect((await getProductionRunMaterialBalance(fixture.ctx, runId)).balance)
      .toMatchObject({ activeReturnedDryKg: 40, conversionLossDryKg: 40 });
    await recordProductionRunReturn(fixture.ctx, input());
    const full = await getProductionRunMaterialBalance(fixture.ctx, runId);
    expect(full.balance).toMatchObject({ activeReturnedDryKg: 80, conversionLossDryKg: 0 });
    expect(full.returns).toHaveLength(2);
    expect(full.returns[0]).toMatchObject({ storageLocationId: binId, destinationCode: 'RETURN-BIN',
      wetMassKg: 50, dryMassKg: 40, moistureRatio: 0.2 });
    await correctProductionRunReturn(fixture.ctx, { sourceProductionRunId: runId, storageLocationId: binId,
      correctsMovementId: first.id, reason: 'Correct measurement', idempotencyKey: crypto.randomUUID(), replacement: input(25) });
    const corrected = await getProductionRunMaterialBalance(fixture.ctx, runId);
    expect(corrected.balance).toMatchObject({ activeReturnedDryKg: 60, conversionLossDryKg: 20 });
    expect(corrected.returns).toHaveLength(2);
    expect(corrected.returns.some(row => row.movementId === first.id)).toBe(false);
  });

  it('keeps the run boundary unchanged after a storage loss', async () => {
    await recordProductionRunReturn(fixture.ctx, input());
    const before = await getProductionRunMaterialBalance(fixture.ctx, runId);
    await createBinMovement(fixture.ctx, { storageLocationId: binId, lane: 'feedstock', movementType: 'loss',
      massDeltaKg: -10, reason: 'Measured storage spill', occurredAt: new Date('2026-01-02T13:00:00Z'), idempotencyKey: crypto.randomUUID() });
    expect(await getProductionRunMaterialBalance(fixture.ctx, runId)).toEqual(before);
  });

  it('does not fabricate missing dry mass or expose a foreign run', async () => {
    await db.update(productionRuns).set({ feedstockMassDryKg: null })
      .where(eq(productionRuns.organizationId, fixture.ctx.organizationId));
    const result = await getProductionRunMaterialBalance(fixture.ctx, runId);
    expect(result.balance).toBeNull();
    expect(result.missingReason).toContain('consumed dry mass');
    await expect(getProductionRunMaterialBalance({ ...fixture.ctx, organizationId: 'foreign' }, runId)).rejects.toThrow('not found');
    await expect(getProductionRunMaterialBalance({ ...fixture.ctx, userId: '' }, runId)).rejects.toThrow('Unauthorized');
  });
});
