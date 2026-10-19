import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { applications, binMovements, creditBatchApplications, deliveries, facilities } from '@/db/schema';
import { updateDeliveryInTransaction } from '@/data-access/delivery-output-writes';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { previewOutputStock } from '@/data-access/output-stock-operations';
import { getOutputBinStockView } from '@/data-access/output-stock';
import { updateStorageLocation } from '@/data-access/storage-locations';
import { updateDelivery, deletePostedDelivery } from '@/lib/operations/deliveries';
import { runOperationInProcess } from '@/lib/operations/runner';
import { buildStockLevelSeries } from '@/components/storage-locations/stock-level-series';
import { createDelivery } from './helpers/create-delivery';
import { withLineageFixture } from './helpers/certification-lineage-fixture';
import { ensureTestOrg, makeTestOrgContext } from './helpers/test-org';
import { cleanupPostedStock, postedStockFixture, postDelivery, postProduct, postMeasurement, deliveryInput, STOCK_TIME } from './helpers/posted-output-stock-fixture';

const EARLIER = '2026-09-13T12:00:00.000Z';
const LATER = '2026-09-15T12:00:00.000Z';
const BEFORE_PLACEMENT = '2026-09-11T12:00:00.000Z';
const FUTURE = '2099-01-01T12:00:00.000Z';
const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
type Fixture = Awaited<ReturnType<typeof postedStockFixture>>;
beforeAll(() => ensureTestOrg());
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });
async function fixture() { const f = await postedStockFixture(); fixtures.push(f); return f; }
async function storedDelivery(f: Fixture, id: string) {
  const [row] = await db.select().from(deliveries).where(and(eq(deliveries.organizationId, f.ctx.organizationId), eq(deliveries.id, id)));
  return row;
}
async function correctionInput(f: Fixture, deliveryId: string, occurredAt: string) {
  const movement = (await getOutputStockHistory(f.ctx, f.bin.id)).find(e => e.deliveryId === deliveryId && e.kind === 'delivery')!;
  return { facilityId: f.facility.id, storageLocationId: f.bin.id, kind: 'delivery' as const, wetMassKg: 100,
    moisturePercent: 0, correctsMovementId: movement.id, occurredAt };
}

it.each([EARLIER, LATER])('moves the latest delivery to %s with one correction, unchanged balance and captured date', async occurredAt => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100, 20);
  const before = await getOutputBinStockView(f.ctx, f.bin.id);
  const capture = vi.fn();
  const saved = await db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, delivery.id,
    { expectedVersion: delivery.version, deliveryDate: new Date(occurredAt) }, capture));
  expect(saved).toMatchObject({ deliveryDate: new Date(occurredAt), deliveredWetMassKg: 100, moistureContentPercent: 20, massDryKg: 80 });
  expect(await storedDelivery(f, delivery.id)).toMatchObject({ deliveryDate: new Date(occurredAt), massDryKg: 80 });
  expect(capture).toHaveBeenCalledWith(delivery.id, expect.objectContaining({ deliveryDate: new Date(STOCK_TIME) }), expect.objectContaining({ deliveryDate: new Date(occurredAt) }));
  const history = await getOutputStockHistory(f.ctx, f.bin.id);
  expect(history.filter(e => e.kind === 'replacement')).toMatchObject([{ occurredAt, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80 }]);
  expect(history.filter(e => e.kind === 'reversal')).toMatchObject([{ occurredAt: STOCK_TIME, dryMassKg: -80 }]);
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: before.dryMassKg, estimatedWetMassKg: before.estimatedWetMassKg });
  // The physical chart must cancel the old departure at its original instant.
  const points = buildStockLevelSeries(history).points;
  expect(points.filter(p => p.t === Date.parse(STOCK_TIME)).at(-1)?.dryKg).toBe(occurredAt === EARLIER ? 920 : 1000);
  expect(points.at(-1)?.dryKg).toBe(920);
});

it.each([EARLIER, '2026-09-16T12:00:00.000Z'])('allows moving to %s after a later product addition', async target => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  await postProduct(f, { massKg: 100, placedAt: LATER });
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(target) }))
    .toMatchObject({ deliveryDate: new Date(target), massDryKg: 100 });
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 1000 });
});

it('uses the mass lock message after a later dependent draw', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  await postMeasurement(f, { kind: 'loss', wetMassKg: 10, occurredAt: LATER });
  const massError = await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveredWetMassKg: 90 }).catch(error => error);
  expect(massError).toMatchObject({ code: 'certification_locked', message: expect.stringContaining('later') });
  await expect(updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(EARLIER) }))
    .rejects.toMatchObject({ code: massError.code, message: massError.message });
});

it.each(['application', 'credit batch', 'removal', 'ghgStatement'] as const)('uses the mass lock message when held by %s', async holder => {
  await withLineageFixture(async f => {
    const ctx = makeTestOrgContext();
    if (holder === 'application') await db.delete(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.applicationId, f.applicationId)));
    const [delivery] = await db.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, f.deliveryId)));
    expect(await db.select().from(applications).where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, f.applicationId)))).toHaveLength(1);
    if (holder === 'credit batch') expect(await db.select().from(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.applicationId, f.applicationId)))).toHaveLength(1);
    const massError = await updateDelivery(ctx, delivery.id, { expectedVersion: delivery.version, deliveredWetMassKg: 90 }).catch(error => error);
    expect(massError).toMatchObject({ code: 'certification_locked' });
    await expect(updateDelivery(ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(EARLIER) }))
      .rejects.toMatchObject({ code: massError.code, message: massError.message });
  }, holder === 'removal' || holder === 'ghgStatement' ? holder : 'none');
});

it('refuses moving before the source stock existed without writing anything', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  const before = await getOutputStockHistory(f.ctx, f.bin.id);
  const preview = await previewOutputStock(f.ctx, await correctionInput(f, delivery.id, BEFORE_PLACEMENT));
  expect(preview.blockingMessage).toBeTruthy();
  await expect(updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(BEFORE_PLACEMENT) }))
    .rejects.toThrow(preview.blockingMessage!);
  expect(await storedDelivery(f, delivery.id)).toEqual(expect.objectContaining({ deliveryDate: delivery.deliveryDate, version: delivery.version }));
  expect(await getOutputStockHistory(f.ctx, f.bin.id)).toEqual(before);
});

it.each([
  { target: '2026-09-12T18:00:00.000Z', blocker: EARLIER, direction: 'earlier' },
  { target: '2026-09-16T12:00:00.000Z', blocker: LATER, direction: 'later' },
  { target: LATER, blocker: LATER, direction: 'onto a later instant' },
  { target: STOCK_TIME, blocker: STOCK_TIME, direction: 'past a later sequence at the same instant' },
])('preview and write refuse moving $direction past an independent draw', async ({ target, blocker }) => {
  const f = await fixture();
  await db.update(facilities).set({ timezone: 'Africa/Dar_es_Salaam' }).where(and(eq(facilities.organizationId, f.ctx.organizationId), eq(facilities.id, f.facility.id)));
  const other = await postProduct(f, { massKg: 100 });
  // Explicit disjoint sub-bins keep the dependency guard Open, isolating crossing.
  if (blocker === EARLIER) await postMeasurement(f, { kind: 'loss', wetMassKg: 10, occurredAt: blocker, sources: [{ layerId: other.id, moisturePercent: 0 }] });
  const delivery = await createDelivery(f.ctx, { ...await deliveryInput(f, 100), sources: [{ layerId: f.product!.id, moisturePercent: 0 }] });
  if (blocker !== EARLIER) await postMeasurement(f, { kind: 'loss', wetMassKg: 10, occurredAt: blocker, sources: [{ layerId: other.id, moisturePercent: 0 }] });
  const before = await getOutputStockHistory(f.ctx, f.bin.id);
  const preview = await previewOutputStock(f.ctx, await correctionInput(f, delivery.id, target));
  expect(preview.blockingMessage).toContain('moves the delivery past');
  expect(preview.blockingMessage).toContain('Lost mass');
  expect(preview.blockingMessage).toContain('15:00');
  await expect(updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(target), deliveredWetMassKg: 90 }))
    .rejects.toThrow(preview.blockingMessage!);
  expect(await getOutputStockHistory(f.ctx, f.bin.id)).toEqual(before);
  expect(await storedDelivery(f, delivery.id)).toMatchObject({ deliveryDate: delivery.deliveryDate, version: delivery.version });
});

it('allows moving onto an earlier draw instant because the replacement sorts after it', async () => {
  const f = await fixture();
  await postMeasurement(f, { kind: 'loss', wetMassKg: 10, occurredAt: EARLIER });
  const delivery = await postDelivery(f, 100);
  const preview = await previewOutputStock(f.ctx, await correctionInput(f, delivery.id, EARLIER));
  expect(preview.blockingMessage).toBeNull();
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(EARLIER) })).toMatchObject({ deliveryDate: new Date(EARLIER) });
});

it('ignores a reversed delivery and its reversal when moving earlier', async () => {
  const f = await fixture();
  const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, kind: 'delivery', wetMassKg: 100, moisturePercent: 0, occurredAt: EARLIER });
  const removed = await createDelivery(f.ctx, { ...await deliveryInput(f, 100), deliveryDate: new Date(EARLIER), basisFingerprint: preview.basisFingerprint });
  await runOperationInProcess(deletePostedDelivery, f.ctx, { deliveryId: removed.id, expectedVersion: removed.version });
  const delivery = await postDelivery(f, 100);
  const target = '2026-09-12T18:00:00.000Z';
  expect((await previewOutputStock(f.ctx, await correctionInput(f, delivery.id, target))).blockingMessage).toBeNull();
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(target) })).toMatchObject({ deliveryDate: new Date(target) });
});

it('refuses future delivery times without changing history', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  const before = await getOutputStockHistory(f.ctx, f.bin.id);
  await expect(updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(FUTURE) }))
    .rejects.toThrow('Date and time cannot be in the future.');
  expect(await getOutputStockHistory(f.ctx, f.bin.id)).toEqual(before);
});

it('combines mass, moisture and date in one reversal and one replacement', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(EARLIER), deliveredWetMassKg: 50, moistureContentPercent: 20 }))
    .toMatchObject({ deliveryDate: new Date(EARLIER), deliveredWetMassKg: 50, moistureContentPercent: 20, massDryKg: 40 });
  const history = await getOutputStockHistory(f.ctx, f.bin.id);
  expect(history.filter(e => e.kind === 'reversal')).toHaveLength(1);
  expect(history.filter(e => e.kind === 'replacement')).toMatchObject([{ occurredAt: EARLIER, wetMassKg: 50, moisturePercent: 20, dryMassKg: 40 }]);
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 960 });
});

it.each(['delivery', 'count', 'production_draw', 'product_draw', 'replacement'] as const)('prevents crossing a live %s, including entries with no allocations', async kind => {
  const f = await fixture();
  if (kind === 'delivery') {
    const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, kind, wetMassKg: 100, moisturePercent: 0, occurredAt: EARLIER });
    await createDelivery(f.ctx, { ...await deliveryInput(f, 100), deliveryDate: new Date(EARLIER), basisFingerprint: preview.basisFingerprint });
  } else if (kind === 'count') {
    // No shortage, so this count has no allocation rows to discover it through.
    await postMeasurement(f, { kind, wetMassKg: 1000, occurredAt: EARLIER });
  } else {
    const original = await postMeasurement(f, { kind: 'loss', wetMassKg: 10, occurredAt: EARLIER });
    if (kind === 'replacement') await postMeasurement(f, { kind: 'loss', wetMassKg: 5, occurredAt: EARLIER, correctsMovementId: original.movementId });
    else {
      // Historical draw kinds have no product-bin create form. Retain a real
      // frozen allocation, with the persisted kind the crossing reader sees.
      await db.update(binMovements).set({ outputKind: kind }).where(and(eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.id, original.movementId)));
    }
  }
  const delivery = await postDelivery(f, 100);
  const target = '2026-09-12T18:00:00.000Z';
  const preview = await previewOutputStock(f.ctx, await correctionInput(f, delivery.id, target));
  expect(preview.blockingMessage).toContain('moves the delivery past');
  await expect(updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(target) })).rejects.toThrow(preview.blockingMessage!);
});

it('allows crossing a stock-mode merge without treating it as a draw', async () => {
  const f = await fixture();
  await updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, stockMode: 'mix', mergedAt: new Date(EARLIER) });
  const delivery = await postDelivery(f, 100);
  const target = '2026-09-12T18:00:00.000Z';
  expect((await previewOutputStock(f.ctx, await correctionInput(f, delivery.id, target))).blockingMessage).toBeNull();
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(target) })).toMatchObject({ deliveryDate: new Date(target) });
});

async function subBinDeliveryBeforeMerge() {
  const f = await fixture();
  await db.update(facilities).set({ timezone: 'Africa/Dar_es_Salaam' }).where(and(eq(facilities.organizationId, f.ctx.organizationId), eq(facilities.id, f.facility.id)));
  const other = await postProduct(f, { massKg: 50 });
  const sources = [{ layerId: other.id, moisturePercent: 0 }, { layerId: f.product!.id, moisturePercent: 20 }];
  const delivery = await createDelivery(f.ctx, { ...await deliveryInput(f, 100), sources });
  await updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, stockMode: 'mix', mergedAt: new Date(LATER) });
  return { f, delivery };
}

it.each([LATER, '2026-09-16T12:00:00.000Z'])('refuses moving an inherited sub-bin delivery to %s with the merge time and no writes', async target => {
  const { f, delivery } = await subBinDeliveryBeforeMerge();
  const beforeHistory = await getOutputStockHistory(f.ctx, f.bin.id);
  const beforeDelivery = await storedDelivery(f, delivery.id);
  const beforeStock = await getOutputBinStockView(f.ctx, f.bin.id);
  const preview = await previewOutputStock(f.ctx, { ...await correctionInput(f, delivery.id, target), moisturePercent: undefined });
  expect(preview.blockingMessage).toBe('This time is after the bin was merged on Sep 15, 2026, 15:00. A load drawn by sub-bin cannot move past the merge. Choose a time before it.');
  expect(preview.allocations).toEqual([]);
  expect(preview.afterDryKg).toBe(preview.beforeDryKg);
  await expect(updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(target) }))
    .rejects.toThrow(preview.blockingMessage!);
  expect(await storedDelivery(f, delivery.id)).toEqual(beforeDelivery);
  expect(await getOutputStockHistory(f.ctx, f.bin.id)).toEqual(beforeHistory);
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toEqual(beforeStock);
});

it('keeps inherited sub-bin readings when moving a delivery before the later merge', async () => {
  const { f, delivery } = await subBinDeliveryBeforeMerge();
  const target = '2026-09-15T06:00:00.000Z';
  const preview = await previewOutputStock(f.ctx, { ...await correctionInput(f, delivery.id, target), moisturePercent: undefined });
  expect(preview).toMatchObject({ blockingMessage: null, stockMode: 'split', removedDryKg: 90 });
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(target) }))
    .toMatchObject({ deliveryDate: new Date(target), deliveredWetMassKg: 100, massDryKg: 90, moistureContentPercent: 10 });
  const history = await getOutputStockHistory(f.ctx, f.bin.id);
  const original = history.find(e => e.kind === 'delivery')!;
  const replacement = history.find(e => e.kind === 'replacement')!;
  expect(replacement).toMatchObject({ occurredAt: target, dryMassKg: 90 });
  expect(replacement.allocations).toHaveLength(original.allocations.length);
  expect(replacement.allocations).toEqual(expect.arrayContaining(original.allocations.map(a => ({ ...a, runs: expect.arrayContaining(a.runs) }))));
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 960 });
});

it('leaves Lost mass time corrections able to cross an independent draw', async () => {
  const f = await fixture();
  const other = await postProduct(f, { massKg: 100 });
  const original = await postMeasurement(f, { kind: 'loss', wetMassKg: 10, sources: [{ layerId: f.product!.id, moisturePercent: 0 }] });
  await postMeasurement(f, { kind: 'loss', wetMassKg: 10, occurredAt: LATER, sources: [{ layerId: other.id, moisturePercent: 0 }] });
  const target = '2026-09-16T12:00:00.000Z';
  const saved = await postMeasurement(f, { kind: 'loss', wetMassKg: 5, occurredAt: target, correctsMovementId: original.movementId });
  expect(saved.preview.blockingMessage).toBeNull();
  expect((await getOutputStockHistory(f.ctx, f.bin.id)).find(e => e.kind === 'reversal')).toMatchObject({ occurredAt: target });
});

it('can move the live replacement again while ignoring the corrected originals', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  const first = await updateDelivery(f.ctx, delivery.id, { expectedVersion: delivery.version, deliveryDate: new Date(EARLIER) });
  const current = (await getOutputStockHistory(f.ctx, f.bin.id)).find(e => e.kind === 'replacement')!;
  expect(await updateDelivery(f.ctx, delivery.id, { expectedVersion: first.version, correctsMovementId: current.id, deliveryDate: new Date(LATER) })).toMatchObject({ deliveryDate: new Date(LATER) });
  const history = await getOutputStockHistory(f.ctx, f.bin.id);
  expect(history.filter(e => e.kind === 'reversal').map(e => e.occurredAt)).toEqual([STOCK_TIME, EARLIER]);
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 900 });
});
