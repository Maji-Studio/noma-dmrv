import { archiveStorageLocation } from '@/data-access/storage-locations';
import { loadRunForwardFactsWithExecutor } from '@/data-access/credit-batch-run-forward-facts';
import { feedstockFixtureValues } from './helpers/feedstock-fixture';
import { archiveFacility, getFacilities } from '@/data-access/facilities';
import { enrichStorageLocationRows } from '@/data-access/storage-location-enrichment';
import { getFeedstockBinStock } from '@/data-access/feedstock-bin-ledger';
import { getIngredientMoistureBasis } from '@/data-access/ingredient-moisture-basis';
import { readRecordDependents } from '@/data-access/record-lock-dependents';
import { getProductionRunDependentProduct } from '@/data-access/production-runs/product-dependencies';
import { deleteProductionRun } from '@/data-access/production-runs/delete';
import { updateProductionRun } from '@/data-access/production-runs/mutations';
import { getBiocharProducts } from '@/data-access/biochar-products';
import { buildStockLevelSeries } from '@/components/storage-locations/stock-level-series';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { activityEvents, facilities, binMovements, biocharProducts, deliveries, orders, storageLocations, feedstocks, outputStockAllocations, outputStockMoistureReadings, productionRuns, productionRunFeedstocks, productionRunFeedstockDraws } from '@/db/schema';
import { getOutputBinStockView, readOutputBinAllLayers, getLayerMoistureBases } from '@/data-access/output-stock';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { deleteDelivery } from '@/data-access/delivery-delete';
import { deleteBiocharProduct } from '@/data-access/biochar-product-delete';
import { deletePostedDelivery, updateDelivery } from '@/lib/operations/deliveries';
import { deletePostedBiocharProduct } from '@/lib/operations/biochar-products';
import { deleteOrder, updateOrder } from '@/lib/operations/orders';
import { runOperationInProcess } from '@/lib/operations/runner';
import { withLineageFixture } from './helpers/certification-lineage-fixture';
import { ensureTestOrg, makeTestOrgContext } from './helpers/test-org';
import { cleanupPostedStock, postedStockFixture, postDelivery, postMeasurement, postProduct } from './helpers/posted-output-stock-fixture';

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
beforeAll(() => ensureTestOrg());
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });
async function fixture(options: Parameters<typeof postedStockFixture>[0] = {}) { const f = await postedStockFixture(options); fixtures.push(f); return f; }

it('deletes an Open delivery with exact stock restoration, retained history and runner activity', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  const before = await getOutputStockHistory(f.ctx, f.bin.id);
  const original = before.find(row => row.deliveryId === delivery.id)!;
  await runOperationInProcess(deletePostedDelivery, f.ctx, { deliveryId: delivery.id, expectedVersion: delivery.version });
  expect(await db.select().from(deliveries).where(eq(deliveries.id, delivery.id))).toHaveLength(0);
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 1000, estimatedWetMassKg: 1000 });
  expect(await getOutputStockHistory(f.ctx, f.bin.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: original.id }),
    expect.objectContaining({ kind: 'reversal', correctsMovementId: original.id }),
  ]));
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, f.ctx.organizationId), eq(activityEvents.entityId, delivery.id)))).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'deleted', operationId: 'delete_posted_delivery', source: 'form' }),
  ]));
  await runOperationInProcess(deleteOrder, f.ctx, { orderId: f.order.id, expectedVersion: f.order.version });
  expect(await db.select().from(orders).where(eq(orders.id, f.order.id))).toHaveLength(0);
});

it('deletes an Open product and restores its source stock while retaining the reversed draw', async () => {
  const f = await fixture();
  const original = (await getOutputStockHistory(f.ctx, f.source.id)).find(row => row.kind === 'production_draw')!;
  await runOperationInProcess(deletePostedBiocharProduct, f.ctx, { productId: f.product!.id, expectedVersion: f.product!.version });
  expect(await db.select().from(biocharProducts).where(eq(biocharProducts.id, f.product!.id))).toEqual([expect.objectContaining({ archivedAt: expect.any(Date), version: f.product!.version + 1 })]);
  expect((await getBiocharProducts(f.ctx, { facilityId: f.facility.id })).items).toEqual([]);
  expect(await getOutputBinStockView(f.ctx, f.source.id)).toMatchObject({ dryMassKg: 1500, estimatedWetMassKg: 1750 });
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 0 });
  expect(await getOutputStockHistory(f.ctx, f.source.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: original.id }), expect.objectContaining({ kind: 'reversal', correctsMovementId: original.id }),
  ]));
});

it('refuses delivery deletion after a dependent stock draw', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  await postMeasurement(f, { kind: 'loss', wetMassKg: 10 });
  await expect(deleteDelivery(f.ctx, delivery.id, delivery.version)).rejects.toMatchObject({ code: 'certification_locked' });
});

it.each(['none', 'removal'] as const)('refuses In use or Sent delivery and product deletion (%s)', async blocking => {
  await withLineageFixture(async f => {
    const ctx = makeTestOrgContext();
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, f.deliveryId));
    const [product] = await db.select().from(biocharProducts).where(eq(biocharProducts.id, f.productId));
    await expect(deleteDelivery(ctx, delivery.id, delivery.version)).rejects.toMatchObject({ code: 'certification_locked' });
    await expect(deleteBiocharProduct(ctx, product.id, product.version)).rejects.toMatchObject({ code: 'certification_locked' });
  }, blocking);
});

it('allows deleting an archived order after its archived delivery is gone', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, delivery.id));
  await expect(runOperationInProcess(deleteOrder, f.ctx, { orderId: f.order.id, expectedVersion: f.order.version })).rejects.toMatchObject({ code: 'certification_locked' });
  await deleteDelivery(f.ctx, delivery.id, delivery.version);
  await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, f.order.id));
  await expect(runOperationInProcess(deleteOrder, f.ctx, { orderId: f.order.id, expectedVersion: f.order.version })).resolves.toBeUndefined();
});

it.each(['none', 'removal'] as const)('free fields use the same In use and Sent guards (%s)', async blocking => {
  await withLineageFixture(async f => {
    const ctx = makeTestOrgContext();
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, f.deliveryId));
    const [order] = await db.select().from(orders).where(eq(orders.id, f.orderId));
    if (blocking === 'none') {
      await expect(updateDelivery(ctx, delivery.id, { expectedVersion: delivery.version, code: `${delivery.code}-EDIT`, distanceNote: 'Reference corrected' })).resolves.toMatchObject({ distanceNote: 'Reference corrected' });
      await expect(runOperationInProcess(updateOrder, ctx, { orderId: order.id, expectedVersion: order.version, code: `${order.code}-EDIT` })).resolves.toBeDefined();
    } else {
      await expect(updateDelivery(ctx, delivery.id, { expectedVersion: delivery.version, distanceNote: 'Reference corrected' })).rejects.toMatchObject({ code: 'certification_locked' });
      await expect(runOperationInProcess(updateOrder, ctx, { orderId: order.id, expectedVersion: order.version, code: `${order.code}-EDIT` })).rejects.toMatchObject({ code: 'certification_locked' });
    }
    await expect(updateDelivery(ctx, delivery.id, { expectedVersion: blocking === 'none' ? delivery.version + 1 : delivery.version, deliveredWetMassKg: 1 })).rejects.toMatchObject({ code: 'certification_locked' });
  }, blocking);
});


it('allows deleting an order that never had deliveries', async () => {
  const f = await fixture();
  await expect(runOperationInProcess(deleteOrder, f.ctx, { orderId: f.order.id, expectedVersion: f.order.version })).resolves.toBeUndefined();
});

it('allows deleting an earlier delivery after its later delivery has been reversed', async () => {
  const f = await fixture();
  const first = await postDelivery(f, 100);
  const second = await postDelivery(f, 100);
  await deleteDelivery(f.ctx, second.id, second.version);
  await deleteDelivery(f.ctx, first.id, first.version);
  expect(await getOutputBinStockView(f.ctx, f.bin.id)).toMatchObject({ dryMassKg: 1000 });
});


it.each(['delivery', 'product'] as const)('serializes concurrent %s deletes with one reversal and stale conflict metadata', async kind => {
  const f = await fixture();
  const record = kind === 'delivery' ? await postDelivery(f, 100) : f.product!;
  const remove = () => kind === 'delivery' ? deleteDelivery(f.ctx, record.id, record.version) : deleteBiocharProduct(f.ctx, record.id, record.version);
  const results = await Promise.allSettled([remove(), remove()]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const conflict = { code: 'stale_version', conflict: { entity: kind === 'product' ? 'biocharProduct' : 'delivery', id: record.id, code: 'stale-version' } };
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: conflict });
  await expect(remove()).rejects.toMatchObject(conflict);
  const history = await getOutputStockHistory(f.ctx, kind === 'delivery' ? f.bin.id : f.source.id);
  expect(history.filter(row => row.kind === 'reversal')).toHaveLength(1);
  expect(await getOutputBinStockView(f.ctx, kind === 'delivery' ? f.bin.id : f.source.id)).toMatchObject({ dryMassKg: kind === 'delivery' ? 1000 : 1500 });
});

it('retains destination placement and its reversal pointing at the archived product', async () => {
  const f = await fixture();
  const intake = (await getOutputStockHistory(f.ctx, f.bin.id)).find(row => row.kind === 'intake')!;
  await deleteBiocharProduct(f.ctx, f.product!.id, f.product!.version);
  const history = await getOutputStockHistory(f.ctx, f.bin.id);
  expect(history).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: intake.id, allocations: intake.allocations, source: { entity: 'biocharProduct', id: f.product!.id } }),
    expect.objectContaining({ kind: 'reversal', correctsMovementId: intake.id, source: intake.source }),
  ]));
  expect(buildStockLevelSeries(history).points.at(-1)).toMatchObject({ dryKg: 0, waterKg: 0 });
  expect((await readOutputBinAllLayers(f.ctx, f.bin.id, db, { includeArchived: true })).layers).toEqual([]);
});

it('releases product and run dependencies after each reversal, allowing run edits but retaining runs held by stock history', async () => {
  const f = await fixture();
  const delivery = await postDelivery(f, 100);
  const dependents = (entityType: 'biocharProduct' | 'productionRun', entityId: string) => readRecordDependents(f.ctx, db, { entityType, entityId });
  expect(await dependents('biocharProduct', f.product!.id)).not.toEqual([]);
  await deleteDelivery(f.ctx, delivery.id, delivery.version);
  expect(await dependents('biocharProduct', f.product!.id)).toEqual([]);
  const [product] = await db.select().from(biocharProducts).where(eq(biocharProducts.id, f.product!.id));
  await deleteBiocharProduct(f.ctx, product.id, product.version);
  for (const run of f.runs) {
    expect(await dependents('productionRun', run.id)).toEqual([]);
    await expect(db.transaction(tx => getProductionRunDependentProduct(f.ctx, tx, run.id))).resolves.toBeUndefined();
  }
  const run = f.runs[0];
  const updated = await updateProductionRun(f.ctx, run.id, { expectedVersion: run.version, biocharOutputKg: 1100 });
  const savedRun = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id));
  const history = await getOutputStockHistory(f.ctx, f.source.id);
  const reversals = await db.select().from(binMovements).where(and(eq(binMovements.storageLocationId, f.source.id), eq(binMovements.outputKind, 'reversal')));
  for (const reversal of reversals) expect(history.find(row => row.id === reversal.id)).toMatchObject({
    beforeDryKg: Number(reversal.balanceBeforeDryKg), afterDryKg: Number(reversal.balanceAfterDryKg),
  });
  const links = await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, run.id));
  const draws = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, run.id));
  await expect(deleteProductionRun(f.ctx, run.id, updated.version)).rejects.toMatchObject({
    code: 'certification_locked',
    message: 'This production run cannot be deleted. Held by stock entry in retained stock history. You can archive it with its facility.',
  });
  expect(await db.select().from(productionRuns).where(eq(productionRuns.id, run.id))).toEqual(savedRun);
  expect(await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, run.id))).toEqual(links);
  expect(await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, run.id))).toEqual(draws);
  expect(await getOutputStockHistory(f.ctx, f.source.id)).toEqual(history);
});

it.each(['delivery', 'product'] as const)('restores every frozen FIFO allocation and moisture basis after %s deletion', async kind => {
  const f = await fixture({ stockKg: 0 });
  if (kind === 'delivery') {
    await postProduct(f, { massKg: 600 });
    await postProduct(f, { massKg: 400, placedAt: '2026-09-13T12:00:00Z' });
  }
  const bin = kind === 'delivery' ? f.bin : f.source;
  const binId = bin.id;
  const before = await readOutputBinAllLayers(f.ctx, binId);
  const moistureBefore = await getLayerMoistureBases(f.ctx, bin, before.layers);
  const record = kind === 'delivery' ? await postDelivery(f, 900, 25) : await postProduct(f, { massKg: 1000 });
  const allocations = await db.select().from(outputStockAllocations).where(and(eq(outputStockAllocations.organizationId, f.ctx.organizationId),
    kind === 'delivery' ? eq(outputStockAllocations.deliveryId, record.id) : eq(outputStockAllocations.targetBiocharProductId, record.id)));
  expect(allocations).toHaveLength(2);
  // Legacy departures could carry readings; reversal must leave this evidence but ignore its basis.
  for (const allocation of allocations) await db.insert(outputStockMoistureReadings).values({ organizationId: f.ctx.organizationId, storageLocationId: binId,
    movementId: allocation.movementId, biocharProductId: allocation.biocharProductId, productionRunId: allocation.productionRunId,
    moisturePercent: 60, solidsBasisKg: { numerator: '100', denominator: '1' }, occurredAt: new Date('2026-09-14T12:00:00Z') });
  if (kind === 'delivery') await deleteDelivery(f.ctx, record.id, record.version);
  else await deleteBiocharProduct(f.ctx, record.id, record.version);
  const effects = await db.select().from(outputStockAllocations).where(and(eq(outputStockAllocations.organizationId, f.ctx.organizationId), eq(outputStockAllocations.sourceStorageLocationId, binId)));
  for (const original of allocations) {
    const inverse = effects.find(row => row.reversesAllocationId === original.id)!;
    expect(inverse).toMatchObject({ biocharProductId: original.biocharProductId, productionRunId: original.productionRunId,
      basisSnapshot: expect.objectContaining({ policy: original.basisSnapshot.policy, placedAt: original.basisSnapshot.placedAt, postingSequence: original.basisSnapshot.postingSequence }) });
    expect(Number(inverse.dryMassKg)).toBe(-Number(original.dryMassKg));
    expect(Number(inverse.wetMassKg)).toBe(-Number(original.wetMassKg));
  }
  expect(await db.select().from(outputStockMoistureReadings).where(eq(outputStockMoistureReadings.storageLocationId, binId))).toHaveLength(allocations.length);
  const after = await readOutputBinAllLayers(f.ctx, binId);
  expect(after.layers).toEqual(before.layers);
  expect(await getLayerMoistureBases(f.ctx, bin, after.layers)).toEqual(moistureBefore);
  expect(await getOutputBinStockView(f.ctx, binId)).toMatchObject({ dryMassKg: kind === 'delivery' ? 1000 : 1500, estimatedWetMassKg: kind === 'delivery' ? 1000 : 1750 });
});


it('restores ingredient stock and keeps the crossed-out ingredient history and product provenance', async () => {
  const f = await fixture({ stockKg: 0 });
  await db.update(storageLocations).set({ formulationId: f.recipe.id }).where(eq(storageLocations.id, f.bin.id));
  const [ingredientBin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    code: `E2E-ING-${f.tag}`, name: `E2E Ingredient ${f.tag}`, type: 'feedstock_bin', feedstockTypeId: f.ingredientType.id }).returning();
  await db.insert(feedstocks).values(await feedstockFixtureValues(db, { organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    feedstockTypeId: f.ingredientType.id, storageLocationId: ingredientBin.id, code: `E2E-ING-FS-${f.tag}`, status: 'complete',
    deliveryDate: new Date('2026-09-01'), massWetKg: 100, massDryKg: 80, moistureContentPercent: 20 }));
  const product = await postProduct(f, { formulationId: f.recipe.id, massKg: 100, composition: { ingredients: [{ formulationIngredientId: f.ingredient.id,
    feedstockTypeId: f.ingredientType.id, storageLocationId: ingredientBin.id, massKg: 20, moistureContentPercent: 20 }] } });
  expect((await getFeedstockBinStock(f.ctx, ingredientBin.id)).currentWetKg).toBe(80);
  await db.update(storageLocations).set({ archivedAt: new Date() }).where(eq(storageLocations.id, ingredientBin.id));
  await expect(deleteBiocharProduct(f.ctx, product.id, product.version)).rejects.toThrow('Storage bin was not found or is archived.');
  expect((await getFeedstockBinStock(f.ctx, ingredientBin.id)).currentWetKg).toBe(80);
  await db.update(storageLocations).set({ archivedAt: null }).where(eq(storageLocations.id, ingredientBin.id));
  await deleteBiocharProduct(f.ctx, product.id, product.version);
  const stock = await getFeedstockBinStock(f.ctx, ingredientBin.id);
  expect(stock.currentWetKg).toBe(100);
  expect(stock.entries).toContainEqual(expect.objectContaining({ sourceId: product.id, kind: 'ingredient_draw', reversed: true, wetDeltaKg: -20 }));
  expect(await getIngredientMoistureBasis(f.ctx, ingredientBin.id)).toMatchObject({ wetMassKg: 100, dryMassKg: 80 });
  expect((await getOutputStockHistory(f.ctx, f.bin.id)).find(row => row.id === product.id)).toMatchObject({ solidsDeltaKg: 96 });
});


it('excludes a deleted 50 kg pure product from facility and bin inventory totals', async () => {
  const f = await fixture({ stockKg: 0 });
  await deleteProductionRun(f.ctx, f.runs[1].id, f.runs[1].version);
  await updateProductionRun(f.ctx, f.runs[0].id, { expectedVersion: f.runs[0].version, biocharOutputKg: 100, biocharMoisturePercent: 0 });
  const product = await postProduct(f, { massKg: 50 });
  expect((await getFacilities(f.ctx)).items[0].inventorySummary).toMatchObject({ biocharKg: 50, productKg: 50 });
  await deleteBiocharProduct(f.ctx, product.id, product.version);
  expect((await getFacilities(f.ctx)).items[0].inventorySummary).toMatchObject({ biocharKg: 100, productKg: 0 });
  const [bin] = await enrichStorageLocationRows(f.ctx, [{ ...f.bin, facilityName: f.facility.name, facilityCode: f.facility.code, feedstockTypeName: null, formulationName: f.pure.name }]);
  expect(bin.productInventory).toMatchObject({ batchCount: 0, currentMassKg: 0 });
  const [source] = await enrichStorageLocationRows(f.ctx, [{ ...f.source, facilityName: f.facility.name, facilityCode: f.facility.code, feedstockTypeName: null, formulationName: null }]);
  expect(source.biocharInventory).toMatchObject({ allocatedToProductsKg: 0 });
});

it('replays destination reversal balances alongside another retained product', async () => {
  const f = await fixture({ stockKg: 0 });
  await postProduct(f, { massKg: 40 });
  const removed = await postProduct(f, { massKg: 60 });
  await deleteBiocharProduct(f.ctx, removed.id, removed.version);
  const history = await getOutputStockHistory(f.ctx, f.bin.id);
  expect(history.find(row => row.kind === 'reversal')).toMatchObject({ beforeDryKg: 100, afterDryKg: 40, dryMassKg: 60 });
});

it('keeps only the replacement product in live run-forwards after deletion', async () => {
  const f = await fixture({ stockKg: 50 });
  const runIds = f.runs.map(run => run.id);
  const before = await loadRunForwardFactsWithExecutor(f.ctx, runIds, db);
  expect(Object.values(before).flat().map(product => product.id)).toContain(f.product!.id);
  await deleteBiocharProduct(f.ctx, f.product!.id, f.product!.version);
  const replacement = await postProduct(f, { massKg: 50 });
  const after = await loadRunForwardFactsWithExecutor(f.ctx, runIds, db);
  expect(Object.values(after).flat().map(product => product.id)).toEqual([replacement.id]);
  expect((await getOutputStockHistory(f.ctx, f.bin.id)).map(row => row.id)).toContain(f.product!.id);
});

it('preserves inventory totals when a facility archives its products', async () => {
  const f = await fixture({ stockKg: 50 });
  const before = (await getFacilities(f.ctx)).items.find(row => row.id === f.facility.id)!.inventorySummary;
  expect(before.productKg).toBe(50);
  await archiveFacility(f.ctx, f.facility.id, f.facility.version);
  const after = (await getFacilities(f.ctx, { archived: true })).items.find(row => row.id === f.facility.id)!.inventorySummary;
  expect(after).toEqual(before);
  const [bin] = await enrichStorageLocationRows(f.ctx, [{ ...f.bin, facilityName: f.facility.name, facilityCode: f.facility.code, feedstockTypeName: null, formulationName: f.pure.name }]);
  expect(bin.productInventory).toMatchObject({ batchCount: 1, currentMassKg: 50 });
});


it.each(['count', 'loss'] as const)('releases a product after its covering %s is reversed before placement', async kind => {
  const f = await fixture({ stockKg: 0 });
  if (kind === 'loss') await postProduct(f, { massKg: 100, placedAt: '2026-09-10T12:00:00Z' });
  const placed = await postProduct(f, { massKg: 1000 });
  const original = await postMeasurement(f, { kind, wetMassKg: kind === 'count' ? 1000 : 110 });
  const target = { entityType: 'biocharProduct' as const, entityId: placed.id };
  expect(await readRecordDependents(f.ctx, db, target)).not.toEqual([]);
  await postMeasurement(f, { kind, wetMassKg: kind === 'count' ? 0 : 10, occurredAt: '2026-09-11T12:00:00Z', correctsMovementId: original.movementId });
  expect(await readRecordDependents(f.ctx, db, target)).toEqual([]);
  const [product] = await db.select().from(biocharProducts).where(eq(biocharProducts.id, placed.id));
  await deleteBiocharProduct(f.ctx, product.id, product.version);
  expect(await getOutputBinStockView(f.ctx, f.source.id)).toMatchObject({ dryMassKg: kind === 'count' ? 1500 : 1400 });
});

it.each(['delivery', 'product'] as const)('refuses %s deletion into an archived bin without changing stock or history', async kind => {
  const f = await fixture({ stockKg: kind === 'product' ? 1500 : 1000 });
  const record = kind === 'delivery' ? await postDelivery(f, 1000) : f.product!;
  const bin = kind === 'delivery' ? f.bin : f.source;
  const before = await getOutputStockHistory(f.ctx, bin.id);
  await archiveStorageLocation(f.ctx, bin.id, bin.version);
  const remove = kind === 'delivery' ? deleteDelivery : deleteBiocharProduct;
  await expect(remove(f.ctx, record.id, record.version)).rejects.toThrow('Storage bin was not found or is archived.');
  expect(await getOutputStockHistory(f.ctx, bin.id)).toEqual(before);
  expect(Number((await readOutputBinAllLayers(f.ctx, bin.id, db, { includeArchived: true })).allLayersDryKg)).toBe(0);
});

it.each(['delivery', 'product'] as const)('refuses %s deletion in an archived facility even with an active bin', async kind => {
  const f = await fixture();
  const record = kind === 'delivery' ? await postDelivery(f, 100) : f.product!;
  const bin = kind === 'delivery' ? f.bin : f.source;
  const before = await getOutputStockHistory(f.ctx, bin.id);
  // Isolate the parent guard from the normal cascade's archived-bin guard.
  await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, f.facility.id));
  const remove = kind === 'delivery' ? deleteDelivery : deleteBiocharProduct;
  await expect(remove(f.ctx, record.id, record.version)).rejects.toThrow('Facility was not found or is archived.');
  expect(await getOutputStockHistory(f.ctx, bin.id)).toEqual(before);
});
