/** Real write-path contracts for #1252. Requires the isolated test database. */
import { afterAll, expect, it } from 'vitest';
import { db } from '@/db';
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
    moistureEstimate: { moisturePercent: 50, wetKg: 110, basis: { source: 'removal', at: STOCK_TIME, kind } }, reestimate: null });
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
