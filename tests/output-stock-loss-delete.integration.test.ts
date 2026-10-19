import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { activityEvents, biocharProducts, binMovements, outputStockAllocations, outputStockMoistureReadings, outputStockRunAllocations } from '@/db/schema';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { outputMovementLockReason } from '@/data-access/output-stock-edit-lock';
import { readOutputBinAllLayers } from '@/data-access/output-stock';
import { getOutputSubBins } from '@/data-access/output-sub-bins';
import { previewOutputStock } from '@/data-access/output-stock-operations';
import { correctOutputStockEntry } from '@/lib/operations/output-stock-form-edits';
import { ALREADY_CORRECTED_MESSAGE, ALREADY_DELETED_MESSAGE } from '@/lib/loss-correction-messages';
import { buildStockLevelSeries } from '@/components/storage-locations/stock-level-series';
import { removeOutputLossFn } from '@/fn/output-stock';
import type { RemoveLossData } from '@/schemas/bin-movements';
import { cleanupPostedStock, postedStockFixture, postMeasurement, postProduct, postDelivery, STOCK_TIME } from './helpers/posted-output-stock-fixture';
import { certifyOutputLineage, cleanupCertifiedOutputLineage, LINEAGE_LOCKED_COPY } from './helpers/certified-output-lineage';

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireOrgContext: auth.requireOrgContext }));
const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
const LATER_TIME = '2026-09-15T12:00:00.000Z';
const DELETE_REASON = 'Recorded in error';
afterEach(async () => {
  vi.clearAllMocks();
  for (const f of fixtures.splice(0)) {
    await cleanupCertifiedOutputLineage(f.ctx.organizationId);
    await cleanupPostedStock(f);
  }
});
async function fixture() {
  const f = await postedStockFixture();
  fixtures.push(f);
  auth.requireOrgContext.mockResolvedValue(f.ctx);
  return f;
}
function removal(storageLocationId: string, correctsMovementId: string): RemoveLossData {
  return { storageLocationId, correctsMovementId, idempotencyKey: randomUUID(), reason: DELETE_REASON };
}
async function ledger(f: Awaited<ReturnType<typeof fixture>>) {
  return db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId));
}

/** All persistent effects of Delete, including product versions and audit events. */
async function deleteState(f: Awaited<ReturnType<typeof fixture>>) {
  const organizationId = f.ctx.organizationId;
  return {
    movements: await db.select().from(binMovements).where(eq(binMovements.organizationId, organizationId)).orderBy(binMovements.id),
    allocations: await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.organizationId, organizationId)).orderBy(outputStockAllocations.id),
    runAllocations: await db.select().from(outputStockRunAllocations).where(eq(outputStockRunAllocations.organizationId, organizationId)).orderBy(outputStockRunAllocations.id),
    readings: await db.select().from(outputStockMoistureReadings).where(eq(outputStockMoistureReadings.organizationId, organizationId)).orderBy(outputStockMoistureReadings.id),
    products: await db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, organizationId)).orderBy(biocharProducts.id),
    activity: await db.select().from(activityEvents).where(eq(activityEvents.organizationId, organizationId)).orderBy(activityEvents.id),
  };
}

it.each(['biochar', 'product'] as const)('deletes a %s loss with one inverse and restores history, chart and sub-bins', async lane => {
  const f = await fixture();
  const bin = lane === 'product' ? f.bin : f.source;
  const before = await readOutputBinAllLayers(f.ctx, bin.id);
  const original = await postMeasurement(f, { storageLocationId: bin.id, kind: 'loss', wetMassKg: 100, moisturePercent: 20 });
  const input = removal(bin.id, original.movementId);
  const saved = await removeOutputLossFn(input);
  expect(saved).toMatchObject({ success: true });
  if (!saved.success) throw new Error(saved.error);
  expect(saved.data.savedDeliveries).toEqual([]);
  if (lane === 'product') expect(saved.data.savedProducts).toMatchObject([{ id: f.product!.id, version: original.savedProducts[0].version + 1 }]);
  const corrections = (await ledger(f)).filter(row => row.correctsMovementId === original.movementId);
  expect(corrections).toMatchObject([{ id: saved.data.movementId, outputKind: 'reversal', occurredAt: new Date(STOCK_TIME), reason: DELETE_REASON, idempotencyKey: input.idempotencyKey, outputDryDeltaKg: '80.000' }]);
  expect(corrections).toHaveLength(1);
  const restored = await readOutputBinAllLayers(f.ctx, bin.id);
  expect(restored.allLayersDryKg).toBe(before.allLayersDryKg);
  expect(restored.layers).toEqual(before.layers);
  const history = await getOutputStockHistory(f.ctx, bin.id);
  expect(history.find(row => row.id === original.movementId)?.editLockedReason).toBe(ALREADY_DELETED_MESSAGE);
  expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reversal', correctsMovementId: original.movementId })]));
  expect(buildStockLevelSeries(history).points.at(-1)?.dryKg).toBe(Number(before.allLayersDryKg));
  const subBins = await getOutputSubBins(f.ctx, { storageLocationId: bin.id, facilityId: f.facility.id });
  expect(subBins.subBins.reduce((sum, row) => sum + row.dryMassKg, 0)).toBe(Number(before.allLayersDryKg));
});

it.each(['biochar', 'product'] as const)('refuses a second delete of a %s loss with a new key without writing', async lane => {
  const f = await fixture();
  const bin = lane === 'product' ? f.bin : f.source;
  const original = await postMeasurement(f, { storageLocationId: bin.id, kind: 'loss', wetMassKg: 100 });
  const input = removal(bin.id, original.movementId);
  expect(await removeOutputLossFn(input)).toMatchObject({ success: true });
  const before = await deleteState(f);
  expect(await removeOutputLossFn({ ...input, idempotencyKey: randomUUID() })).toMatchObject({ success: false, error: ALREADY_DELETED_MESSAGE });
  expect(await deleteState(f)).toEqual(before);
});

it.each(['biochar', 'product'] as const)('refuses deleting a %s loss whose source layer is Sent without writing', async lane => {
  const f = await fixture();
  const bin = lane === 'product' ? f.bin : f.source;
  const original = await postMeasurement(f, { storageLocationId: bin.id, kind: 'loss', wetMassKg: 100, moisturePercent: 20 });
  const [allocation] = await db.select().from(outputStockAllocations).where(and(
    eq(outputStockAllocations.organizationId, f.ctx.organizationId), eq(outputStockAllocations.movementId, original.movementId),
  ));
  const [runAllocation] = await db.select().from(outputStockRunAllocations).where(and(
    eq(outputStockRunAllocations.organizationId, f.ctx.organizationId), eq(outputStockRunAllocations.allocationId, allocation.id),
  ));
  await certifyOutputLineage(f, { runId: runAllocation.productionRunId, productId: allocation.biocharProductId ?? undefined,
    deliveryBinId: bin.id, submitted: true });
  const reason = await outputMovementLockReason(f.ctx, bin.id, original.movementId);
  expect(reason).toContain(LINEAGE_LOCKED_COPY);
  const before = await deleteState(f);
  expect(await removeOutputLossFn(removal(bin.id, original.movementId))).toMatchObject({
    success: false, code: 'certification_locked', error: reason, conflict: { entity: 'storageLocation', id: bin.id },
  });
  expect(await deleteState(f)).toEqual(before);
  // Delete restores only the original allocations/readings. Sent checks those
  // same targets first, so this fixture cannot reach assertOutputLayersMutable.
});

it('refuses a later dependent draw without writing, but permits a newer intake', async () => {
  const f = await fixture();
  const original = await postMeasurement(f, { kind: 'loss', wetMassKg: 100 });
  const later = await postMeasurement(f, { kind: 'loss', wetMassKg: 10, occurredAt: LATER_TIME });
  const before = await ledger(f);
  expect(await removeOutputLossFn(removal(f.bin.id, original.movementId))).toMatchObject({ success: false, code: 'certification_locked', conflict: { entity: 'storageLocation', id: f.bin.id } });
  expect(await ledger(f)).toEqual(before);
  expect(await removeOutputLossFn(removal(f.bin.id, later.movementId))).toMatchObject({ success: true });
  await postProduct(f, { massKg: 100, placedAt: '2026-09-11T12:00:00.000Z' });
  expect(await removeOutputLossFn(removal(f.bin.id, original.movementId))).toMatchObject({ success: true });
  expect(Number((await readOutputBinAllLayers(f.ctx, f.bin.id)).allLayersDryKg)).toBe(1100);
});

it('replays identical requests without another reversal, product bump or activity and conflicts on a changed reason', async () => {
  const f = await fixture();
  const original = await postMeasurement(f, { kind: 'loss', wetMassKg: 100 });
  const input = removal(f.bin.id, original.movementId);
  const first = await removeOutputLossFn(input);
  expect(first.success).toBe(true);
  expect(await removeOutputLossFn(input)).toEqual(first);
  expect(await removeOutputLossFn({ ...input, reason: 'Another reason' })).toMatchObject({ success: false, code: 'conflict', conflict: { entity: 'storageLocation', id: f.bin.id } });
  expect((await ledger(f)).filter(row => row.correctsMovementId === original.movementId)).toHaveLength(1);
  if (!first.success) throw new Error(first.error);
  const activity = await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, f.ctx.organizationId), eq(activityEvents.entityId, first.data.movementId)));
  expect(activity).toHaveLength(1);
  expect(activity[0]).toMatchObject({ facilityId: f.facility.id });
});

it('refuses the corrected original and deletes the replacement of an edited loss', async () => {
  const f = await fixture();
  const original = await postMeasurement(f, { kind: 'loss', wetMassKg: 100 });
  const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, occurredAt: STOCK_TIME, kind: 'loss' as const, wetMassKg: 40, moisturePercent: 0, correctsMovementId: original.movementId };
  const preview = await previewOutputStock(f.ctx, input);
  const edited = await correctOutputStockEntry(f.ctx, { ...input, reason: 'Wrong reading', idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint, expectedProductVersions: preview.expectedProductVersions });
  const before = await ledger(f);
  expect(await removeOutputLossFn(removal(f.bin.id, original.movementId))).toMatchObject({ success: false, error: ALREADY_CORRECTED_MESSAGE });
  expect(await ledger(f)).toEqual(before);
  expect(await removeOutputLossFn(removal(f.bin.id, edited.movementId))).toMatchObject({ success: true });
  expect(Number((await readOutputBinAllLayers(f.ctx, f.bin.id)).allLayersDryKg)).toBe(1000);
  const afterDelete = await deleteState(f);
  expect(await removeOutputLossFn(removal(f.bin.id, edited.movementId))).toMatchObject({ success: false, error: ALREADY_DELETED_MESSAGE });
  expect(await deleteState(f)).toEqual(afterDelete);
  const history = await getOutputStockHistory(f.ctx, f.bin.id);
  expect(history.find(row => row.id === original.movementId)?.editLockedReason).toBe(ALREADY_CORRECTED_MESSAGE);
  expect(history.find(row => row.id === edited.movementId)?.editLockedReason).toBe(ALREADY_DELETED_MESSAGE);
});

it.each(['count', 'delivery', 'other-bin', 'other-org'] as const)('refuses a %s entry without writing', async kind => {
  const f = await fixture();
  let movementId: string;
  if (kind === 'delivery') {
    const delivery = await postDelivery(f, 100);
    movementId = (await getOutputStockHistory(f.ctx, f.bin.id)).find(row => row.deliveryId === delivery.id)!.id;
  } else if (kind === 'other-org') {
    const other = await fixture();
    movementId = (await postMeasurement(other, { kind: 'loss', wetMassKg: 100 })).movementId;
    auth.requireOrgContext.mockResolvedValue(f.ctx);
  } else {
    movementId = (await postMeasurement(f, { storageLocationId: kind === 'other-bin' ? f.source.id : f.bin.id, kind: kind === 'count' ? 'count' : 'loss', wetMassKg: 100 })).movementId;
  }
  const before = await ledger(f);
  expect(await removeOutputLossFn(removal(f.bin.id, movementId))).toMatchObject({ success: false, error: 'Choose a Lost mass entry in this bin to delete.' });
  expect(await ledger(f)).toEqual(before);
});
