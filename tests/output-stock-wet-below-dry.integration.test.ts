/** Real write-path contracts for #1252. Requires the isolated test database. */
import { afterAll, expect, it } from 'vitest';
import { db } from '@/db';
import { binMovements, productionRuns, storageLocations } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOutputBinStocks } from '@/data-access/output-stock';
import { previewOutputStock } from '@/data-access/output-stock-operations';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { replayStock } from '@/lib/output-stock/stock-replay';
import { seedOutputStockParents } from './helpers/output-stock-fixture';
import { cleanupOutputStockFixture } from './helpers/output-stock-cleanup';
import { postMeasurement, postProduct, postedStockFixture, postDelivery, STOCK_TIME } from './helpers/posted-output-stock-fixture';

const organizations: string[] = [];
afterAll(async () => { for (const id of organizations) await cleanupOutputStockFixture(db, id); });

async function sourceFixture() {
  const f = await seedOutputStockParents(db);
  organizations.push(f.ctx.organizationId);
  await postMeasurement(f, { storageLocationId: f.source.id, kind: 'count', wetMassKg: 100, moisturePercent: 20 });
  return f;
}

async function assertSaved(f: Awaited<ReturnType<typeof seedOutputStockParents>>, storageLocationId: string, kind: string) {
  const balance = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId, occurredAt: STOCK_TIME,
    kind: 'count', wetMassKg: 0 });
  expect(balance).toMatchObject({ beforeEstimatedWetKg: 110, beforeDryKg: 55, beforeSolidsKg: 55,
    moistureEstimate: { moisturePercent: 50, wetKg: 110, basis: { source: 'draw', at: STOCK_TIME, kind } }, reestimate: null });
  const history = await getOutputStockHistory(f.ctx, storageLocationId);
  expect(replayStock(history).at(-1)?.after).toMatchObject({ wetKg: 110, dryKg: 55, solidsKg: 55 });
}

it('allows the worked lost mass and reads its re-estimate after saving', async () => {
  const f = await sourceFixture();
  const input = { facilityId: f.facility.id, storageLocationId: f.source.id, occurredAt: STOCK_TIME,
    kind: 'loss' as const, wetMassKg: 50, moisturePercent: 50 };
  expect(await previewOutputStock(f.ctx, input)).toMatchObject({ blockingMessage: null, beforeEstimatedWetKg: 100,
    afterEstimatedWetKg: 110, afterDryKg: 55, reestimate: { moisturePercent: 50, stayWetKg: 110, stayDryKg: 55 } });
  await postMeasurement(f, input);
  await assertSaved(f, f.source.id, 'loss');
});

it('allows a delivery draw and preserves the preview re-estimate in saved stock and history', async () => {
  const f = await postedStockFixture();
  organizations.push(f.ctx.organizationId);
  await postMeasurement(f, { kind: 'count', wetMassKg: 100, moisturePercent: 20 });
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME,
    kind: 'delivery' as const, wetMassKg: 50, moisturePercent: 50 };
  expect(await previewOutputStock(f.ctx, input)).toMatchObject({ blockingMessage: null, afterEstimatedWetKg: 110,
    afterDryKg: 55, reestimate: { moisturePercent: 50, stayWetKg: 110, stayDryKg: 55 } });
  await postDelivery(f, 50, 50);
  await assertSaved(f, f.bin.id, 'delivery');
});

it('re-estimates a correction from restored balances and keeps the underlying loss kind', async () => {
  const f = await sourceFixture();
  const original = await postMeasurement(f, { storageLocationId: f.source.id, kind: 'loss', wetMassKg: 10, moisturePercent: 20 });
  await postMeasurement(f, { storageLocationId: f.source.id, kind: 'loss', correctsMovementId: original.movementId, wetMassKg: 50, moisturePercent: 50 });
  await assertSaved(f, f.source.id, 'loss');
});

it('re-estimates a biochar draw through the product writer', async () => {
  const f = await postedStockFixture({ stockKg: 0 });
  organizations.push(f.ctx.organizationId);
  await postMeasurement(f, { storageLocationId: f.source.id, kind: 'count', wetMassKg: 100, moisturePercent: 20 });
  await postProduct(f, { placedAt: STOCK_TIME, massKg: 50, moistureContentPercent: 50 });
  await assertSaved(f, f.source.id, 'production_draw');
});


it.each([{ wetMassKg: 100, wet: 200, solids: 110 }, { wetMassKg: 290, wet: 30, solids: 15 }])(
  'uses the whole mix pile for a $wetMassKg kg real delivery', async ({ wetMassKg, wet, solids }) => {
    const f = await postedStockFixture({ stockKg: 0 });
    organizations.push(f.ctx.organizationId);
    await db.update(storageLocations).set({ stockMode: 'mix' }).where(and(
      eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.bin.id)));
    await postProduct(f, { massKg: 100, moistureContentPercent: 20 });
    await postProduct(f, { massKg: 200, moistureContentPercent: 60 });
    const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id,
      occurredAt: STOCK_TIME, kind: 'delivery', wetMassKg, moisturePercent: 50 });
    expect(preview).toMatchObject({ blockingMessage: null, beforeEstimatedWetKg: 300, afterEstimatedWetKg: wet, afterSolidsKg: solids });
    expect(preview.reestimate === null).toBe(wetMassKg === 100);
    await postDelivery(f, wetMassKg, 50);
    const saved = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id,
      occurredAt: STOCK_TIME, kind: 'count', wetMassKg: 0 });
    expect(saved).toMatchObject({ beforeEstimatedWetKg: wet, beforeSolidsKg: solids });
    const stocks = await getOutputBinStocks(f.ctx, [f.bin.id]);
    expect(stocks.get(f.bin.id)?.estimatedWetMassKg).toBe(wet);
  },
);


it('keeps all mix intake in the reduced-loss correction check', async () => {
  const f = await postedStockFixture({ stockKg: 0 });
  organizations.push(f.ctx.organizationId);
  await db.update(storageLocations).set({ stockMode: 'mix' }).where(and(
    eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.bin.id)));
  await postProduct(f, { massKg: 100, moistureContentPercent: 20 });
  const original = await postMeasurement(f, { kind: 'loss', wetMassKg: 50, moisturePercent: 50 });
  await postProduct(f, { massKg: 200, moistureContentPercent: 60 });
  const correction = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME,
    kind: 'loss' as const, correctsMovementId: original.movementId, wetMassKg: 60, moisturePercent: 75 };
  expect(await previewOutputStock(f.ctx, correction)).toMatchObject({ blockingMessage: null,
    afterEstimatedWetKg: 240, afterSolidsKg: 145, reestimate: null });
  await postMeasurement(f, correction);
  const saved = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id,
    occurredAt: STOCK_TIME, kind: 'count', wetMassKg: 0 });
  expect(saved).toMatchObject({ beforeEstimatedWetKg: 240, beforeSolidsKg: 145 });
});


it.each(['before', 'after'] as const)('uses physical placement when a run created %s the draw is completed later', async recorded => {
  const f = await seedOutputStockParents(db);
  organizations.push(f.ctx.organizationId);
  const drawTime = '2026-09-15T12:00:00.000Z';
  const placedAt = new Date('2026-09-14T12:00:00.000Z');
  const createdAt = new Date(recorded === 'before' ? '2026-09-13T12:00:00.000Z' : '2026-09-16T12:00:00.000Z');
  await db.update(storageLocations).set({ stockMode: 'mix' }).where(and(
    eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.source.id)));
  await db.update(productionRuns).set({ biocharOutputKg: 100, biocharDryMassKg: 80, biocharMoisturePercent: 20,
    endTime: placedAt }).where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.runs[0].id)));
  await db.update(productionRuns).set({ status: 'running', createdAt, endTime: null,
    biocharOutputKg: null, biocharDryMassKg: null }).where(and(
    eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.runs[1].id)));
  const loss = { facilityId: f.facility.id, storageLocationId: f.source.id, occurredAt: drawTime,
    kind: 'loss' as const, wetMassKg: 50, moisturePercent: 50 };
  expect(await previewOutputStock(f.ctx, loss)).toMatchObject({ afterEstimatedWetKg: 110 });
  const posted = await postMeasurement(f, loss);
  await db.update(binMovements).set({ createdAt: new Date(drawTime) }).where(and(
    eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.id, posted.movementId)));
  await db.update(productionRuns).set({ status: 'complete', endTime: placedAt,
    updatedAt: new Date('2026-09-17T12:00:00.000Z'), biocharOutputKg: 200, biocharDryMassKg: 80, biocharMoisturePercent: 60 })
    .where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.runs[1].id)));
  // Once completed, the older physical intake participates in replay of the saved draw.
  expect(await previewOutputStock(f.ctx, { ...loss, kind: 'count', wetMassKg: 0 })).toMatchObject({
    beforeEstimatedWetKg: 250, beforeSolidsKg: 135,
  });
  expect((await getOutputBinStocks(f.ctx, [f.source.id])).get(f.source.id)?.estimatedWetMassKg).toBe(250);
  // A correction preview sees that same physical pile, including its unallocated intake.
  expect(await previewOutputStock(f.ctx, { ...loss, correctsMovementId: posted.movementId })).toMatchObject({
    afterEstimatedWetKg: 250, afterSolidsKg: 135, reestimate: null,
  });
});
