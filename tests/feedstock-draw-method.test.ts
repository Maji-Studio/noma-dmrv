import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, type DbTransaction } from '@/db';
import { binMovements, creditBatchProductionRuns, creditBatches, facilities, feedstocks, feedstockTypes, productionProcesses,
  productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, reactors, storageLocations, users } from '@/db/schema';
import { reallocateRunsForBins } from '@/data-access/feedstock-run-allocations';
import { getFeedstockTransportOwnerBatches } from '@/data-access/feedstock-transport-ownership';
import { getFeedstockDeliveryUsage } from '@/data-access/feedstock-delivery-usage';
import { applyFeedstockMethodChange } from '@/data-access/feedstock-bin-method';
import { lockBinStocks } from '@/data-access/lock-bin-stocks';
import { feedstockFixtureValues } from './helpers/feedstock-fixture';
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from './helpers/test-org';

const ctx = makeTestOrgContext();
const ROLLBACK = new Error('Rollback draw method fixture');
const day = (value: number) => new Date(`2026-01-${String(value).padStart(2, '0')}T12:00:00Z`);

beforeAll(() => ensureTestOrg());
async function fixture(tx: DbTransaction) {
  const tag = crypto.randomUUID();
  const org = { organizationId: TEST_ORG_ID };
  await tx.insert(users).values({ id: ctx.userId, name: 'Test actor', email: `${tag}@example.test` }).onConflictDoNothing();
  const [facility] = await tx.insert(facilities).values({ ...org, ...TEST_SITE_POSITION, code: `DM-F-${tag}`, name: tag, timezone: 'UTC' }).returning();
  const site = { ...org, facilityId: facility.id };
  const [type] = await tx.insert(feedstockTypes).values({ ...org, code: `DM-T-${tag}`, name: tag, category: 'forestry', usage: 'pyrolysis' }).returning();
  const [bin] = await tx.insert(storageLocations).values({ ...site, code: `DM-B-${tag}`, name: tag, type: 'feedstock_bin', feedstockTypeId: type.id }).returning();
  const [output] = await tx.insert(storageLocations).values({ ...site, code: `DM-O-${tag}`, name: `output-${tag}`, type: 'biochar_bin' }).returning();
  const [reactor] = await tx.insert(reactors).values({ ...site, code: `DM-R-${tag}`, identifier: tag, reactorType: 'batch' }).returning();
  const [process] = await tx.insert(productionProcesses).values({ ...site, feedstockTypeId: type.id }).returning();
  const deliveries = await tx.insert(feedstocks).values(await feedstockFixtureValues(tx, [1, 2, 3].map(index => ({
    ...site, code: `DM-FS-${index}-${tag}`, feedstockTypeId: type.id, storageLocationId: bin.id,
    deliveryDate: day(index), massWetKg: 10, massDryKg: 10, moistureContentPercent: 0, status: 'complete' as const,
  })))).returning();
  const runs = await tx.insert(productionRuns).values([4, 6].map(index => ({ ...site, code: `DM-PR-${index}-${tag}`, reactorId: reactor.id,
    startTime: day(index), endTime: day(index + 1), status: 'complete' as const, feedstockWetMassKg: 10, feedstockMassDryKg: 10,
    biocharOutputKg: 1, biocharMoisturePercent: 0, biocharStorageLocationId: output.id }))).returning();
  const batches = await tx.insert(creditBatches).values([4, 6].map(index => ({ ...site, code: `DM-CB-${index}-${tag}`,
    feedstockTypeId: type.id, productionProcessId: process.id, startDate: `2026-01-0${index}`, endDate: `2026-01-0${index + 1}` }))).returning();
  for (const [index, run] of runs.entries()) {
    await tx.insert(creditBatchProductionRuns).values({ ...org, creditBatchId: batches[index].id, productionRunId: run.id });
    await tx.insert(productionRunFeedstockDraws).values({ ...org, productionRunId: run.id, storageLocationId: bin.id, wetMassKg: 10 });
  }
  await lockBinStocks(ctx, tx, [bin.id]);
  return { bin, deliveries, runs, batches };
}
async function scenario(work: (tx: DbTransaction, data: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  await expect(db.transaction(async tx => { await work(tx, await fixture(tx)); throw ROLLBACK; })).rejects.toBe(ROLLBACK);
}
const allocations = (tx: DbTransaction, runId: string) => tx.select({ feedstockId: productionRunFeedstocks.feedstockId, wetKg: productionRunFeedstocks.wetMassUsedKg })
  .from(productionRunFeedstocks).where(and(eq(productionRunFeedstocks.organizationId, TEST_ORG_ID), eq(productionRunFeedstocks.productionRunId, runId)));

describe('feedstock draw methods in the database', () => {
  it('gives each batch only the deliveries touched, leaving untouched transport unowned', () => scenario(async (tx, f) => {
    await reallocateRunsForBins(ctx, tx, [f.bin.id]);
    await tx.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID, productionRunId: f.runs[0].id, feedstockId: f.deliveries[2].id, wetMassUsedKg: 0 });
    const owners = await getFeedstockTransportOwnerBatches(ctx, f.deliveries.map(row => row.id), tx);
    expect(owners.get(f.deliveries[0].id)).toEqual([{ creditBatchId: f.batches[0].id, code: f.batches[0].code }]);
    expect(owners.get(f.deliveries[1].id)).toEqual([{ creditBatchId: f.batches[1].id, code: f.batches[1].code }]);
    expect(owners.has(f.deliveries[2].id)).toBe(false);
    const usage = await getFeedstockDeliveryUsage(ctx, { feedstockIds: f.deliveries.map(row => row.id) }, tx);
    expect(usage.find(row => row.id === f.deliveries[2].id)).toMatchObject({ stillInBinWetKg: 10, owningBatch: null, creditBatches: [] });
  }));
  it('a loss shifts the first touched delivery but never owns its transport', () => scenario(async (tx, f) => {
    await tx.insert(binMovements).values({ organizationId: TEST_ORG_ID, storageLocationId: f.bin.id, lane: 'feedstock', movementType: 'loss',
      massDeltaKg: -10, occurredAt: day(3), reason: 'Test loss', createdBy: ctx.userId });
    await reallocateRunsForBins(ctx, tx, [f.bin.id]);
    expect(await allocations(tx, f.runs[0].id)).toEqual([{ feedstockId: f.deliveries[1].id, wetKg: 10 }]);
    const owners = await getFeedstockTransportOwnerBatches(ctx, f.deliveries.map(row => row.id), tx);
    expect(owners.has(f.deliveries[0].id)).toBe(false);
    const usage = await getFeedstockDeliveryUsage(ctx, { feedstockIds: [f.deliveries[0].id] }, tx);
    expect(usage[0]).toMatchObject({ lostWetKg: 10, owningBatch: null, creditBatches: [] });
  }));
  it('editing an early run replans its later run', () => scenario(async (tx, f) => {
    await reallocateRunsForBins(ctx, tx, [f.bin.id]);
    await tx.update(productionRunFeedstockDraws).set({ wetMassKg: 5 }).where(and(eq(productionRunFeedstockDraws.organizationId, TEST_ORG_ID), eq(productionRunFeedstockDraws.productionRunId, f.runs[0].id)));
    await reallocateRunsForBins(ctx, tx, [f.bin.id], { onlyRunId: f.runs[0].id });
    expect(await allocations(tx, f.runs[1].id)).toEqual(expect.arrayContaining([
      { feedstockId: f.deliveries[0].id, wetKg: 5 }, { feedstockId: f.deliveries[1].id, wetKg: 5 },
    ]));
    expect(await allocations(tx, f.runs[1].id)).toHaveLength(2);
  }));
  it('preserves earlier saved shares when same-start draws share a microsecond transaction timestamp', () => scenario(async (tx, f) => {
    // Same-start runs need distinct reactors: the active reactor/start pair is unique.
    const [reactor] = await tx.insert(reactors).values({ organizationId: TEST_ORG_ID, facilityId: f.bin.facilityId,
      code: `DM-TIE-${crypto.randomUUID()}`, identifier: 'Same-start boundary reactor', reactorType: 'batch' }).returning();
    await tx.update(productionRuns).set({ reactorId: reactor.id }).where(and(
      eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, f.runs[1].id)));
    await tx.update(productionRuns).set({ startTime: day(4) }).where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.facilityId, f.bin.facilityId)));
    const draws = await tx.update(productionRunFeedstockDraws)
      .set({ createdAt: sql`date_trunc('milliseconds', transaction_timestamp()) + interval '123 microseconds'` })
      .where(and(eq(productionRunFeedstockDraws.organizationId, TEST_ORG_ID), eq(productionRunFeedstockDraws.storageLocationId, f.bin.id))).returning();
    draws.sort((a, b) => a.id.localeCompare(b.id));
    expect(draws[0].createdAt).toEqual(draws[1].createdAt);
    // A protected legacy allocation deliberately differs from a fresh Oldest-first plan.
    await tx.insert(productionRunFeedstocks).values(draws.map((draw, index) => ({ organizationId: TEST_ORG_ID,
      productionRunId: draw.productionRunId, feedstockId: f.deliveries[2 - index].id, wetMassUsedKg: 10 })));
    const before = await allocations(tx, draws[0].productionRunId);
    await tx.update(productionRunFeedstockDraws).set({ wetMassKg: 5 }).where(and(eq(productionRunFeedstockDraws.organizationId, TEST_ORG_ID), eq(productionRunFeedstockDraws.id, draws[1].id)));
    await reallocateRunsForBins(ctx, tx, [f.bin.id], { onlyRunId: draws[1].productionRunId });
    expect(await allocations(tx, draws[0].productionRunId)).toEqual(before);
    expect(await allocations(tx, draws[1].productionRunId)).toEqual([{ feedstockId: f.deliveries[0].id, wetKg: 5 }]);
  }));
  it('includes count losses and gains in each delivery conservation identity without transport ownership', () => scenario(async (tx, f) => {
    await tx.insert(binMovements).values([
      { massDeltaKg: -4, occurredAt: day(3) }, { massDeltaKg: 2, occurredAt: day(7) },
    ].map(row => ({ ...row, organizationId: TEST_ORG_ID, storageLocationId: f.bin.id, lane: 'feedstock' as const,
      movementType: 'adjustment' as const, reason: 'Test count', createdBy: ctx.userId, createdAt: row.occurredAt })));
    await reallocateRunsForBins(ctx, tx, [f.bin.id]);
    const usage = await getFeedstockDeliveryUsage(ctx, { feedstockIds: f.deliveries.map(row => row.id) }, tx);
    expect(usage.find(row => row.id === f.deliveries[0].id)?.countWetKg).toBe(4);
    expect(usage.find(row => row.id === f.deliveries[2].id)?.countWetKg).toBe(-2);
    for (const row of usage) expect(row.intakeWetKg).toBeCloseTo(row.creditBatches.reduce((sum, batch) => sum + batch.wetKg, 0)
      + row.unbatchedRunWetKg + row.ingredientWetKg + row.lostWetKg + row.countWetKg + row.stillInBinWetKg, 3);
    const owners = await getFeedstockTransportOwnerBatches(ctx, f.deliveries.map(row => row.id), tx);
    expect(owners.get(f.deliveries[0].id)?.[0].creditBatchId).toBe(f.batches[0].id);
    expect(owners.get(f.deliveries[2].id)?.[0].creditBatchId).toBe(f.batches[1].id);
  }));
  it('ignores mergedAt when changing split draw order', () => scenario(async (tx, f) => {
    const before = new Date();
    const method = await applyFeedstockMethodChange(ctx, tx, f.bin, { drawOrder: 'newest_first', mergedAt: day(1) });
    expect(method.effectiveAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(method.effectiveAt!.getTime()).toBeLessThanOrEqual(Date.now());
  }));
  it('requires merge time after the last event and an empty mixed bin to split', () => scenario(async (tx, f) => {
    await reallocateRunsForBins(ctx, tx, [f.bin.id]);
    await expect(applyFeedstockMethodChange(ctx, tx, f.bin, { stockMode: 'mix', mergedAt: day(6) })).rejects.toThrow(/later than/);
    await expect(applyFeedstockMethodChange(ctx, tx, f.bin, { stockMode: 'mix' })).rejects.toThrow(/Enter when/);
    const method = await applyFeedstockMethodChange(ctx, tx, f.bin, { stockMode: 'mix', mergedAt: day(8) });
    expect(method.effectiveAt).toEqual(day(8));
    const [mixed] = await tx.update(storageLocations).set({ stockMode: method.stockMode, drawOrder: method.drawOrder }).where(and(eq(storageLocations.organizationId, TEST_ORG_ID), eq(storageLocations.id, f.bin.id))).returning();
    await expect(applyFeedstockMethodChange(ctx, tx, mixed, { stockMode: 'split', drawOrder: 'newest_first' })).rejects.toThrow(/Empty this bin/);
    await tx.insert(binMovements).values({ organizationId: TEST_ORG_ID, storageLocationId: f.bin.id, lane: 'feedstock', movementType: 'loss',
      massDeltaKg: -10, occurredAt: day(9), reason: 'Empty test bin', createdBy: ctx.userId });
    const before = new Date();
    const split = await applyFeedstockMethodChange(ctx, tx, mixed, { stockMode: 'split', drawOrder: 'newest_first', mergedAt: day(1) });
    expect(split).toMatchObject({ stockMode: 'split', drawOrder: 'newest_first' });
    expect(split.effectiveAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(split.effectiveAt!.getTime()).toBeLessThanOrEqual(Date.now());
  }));
});

it('refuses an upstream replan that would rewrite a later Sent run', async () => {
  const { withLineageFixture } = await import('./helpers/certification-lineage-fixture');
  await withLineageFixture(async f => {
    await expect(db.transaction(async tx => {
      const [intake] = await tx.select().from(feedstocks).where(and(eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, f.feedstockId)));
      await tx.insert(feedstocks).values({ ...intake, id: crypto.randomUUID(), code: `DM-SENT-${crypto.randomUUID()}`,
        deliveryDate: new Date('2026-06-01T00:00:00Z'), createdAt: new Date('2026-06-01T00:00:00Z') });
      const [early] = await tx.insert(productionRuns).values({ organizationId: TEST_ORG_ID, facilityId: f.facilityId, reactorId: f.reactorId,
        code: `DM-EARLY-${crypto.randomUUID()}`, status: 'running', startTime: new Date('2026-06-12T08:00:00Z') }).returning();
      await tx.insert(productionRunFeedstockDraws).values({ organizationId: TEST_ORG_ID, productionRunId: early.id, storageLocationId: f.feedstockBinId, wetMassKg: 500 });
      await reallocateRunsForBins(ctx, tx, [f.feedstockBinId], { onlyRunId: early.id });
    })).rejects.toMatchObject({ code: 'certification_locked' });
  });
});
