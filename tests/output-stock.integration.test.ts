import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { biocharProducts, binMovements, outputStockAllocations, outputStockRunAllocations, storageLocations, productionRuns, deliveries } from '@/db/schema';
import { createBiocharProduct } from '@/data-access/biochar-product-create';
import { createOrder } from '@/data-access/orders';
import { getDeliveryAllocationProvenance } from '@/data-access/delivery-allocation-provenance';
import { createDelivery, updateDelivery, deleteDelivery } from '@/data-access/delivery-output-writes';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { getMatchingOutputBins, previewOutputStock } from '@/data-access/output-stock-operations';
import { postOutputStock } from '@/data-access/output-stock-post';
import { cleanupOutputStockFixture } from './helpers/output-stock-cleanup';
import { seedOutputStockParents } from './helpers/output-stock-fixture';
import type { OutputStockPreviewInput } from '@/types/output-stock';

const fixtureOrganizations: string[] = [];
beforeAll(async () => { await db.execute(sql`select 1 from output_stock_allocations limit 1`); });
afterAll(async () => { for (const id of fixtureOrganizations) await cleanupOutputStockFixture(db, id); });
async function fixture() {
  const f = await seedOutputStockParents(db);
  fixtureOrganizations.push(f.ctx.organizationId);
  for (const [index, wet, moisture, ingredientWet, ingredientMoisture, date] of [
    [0, 1000, 10, 500, 60, '2026-09-10'], [1, 750, 20, 250, 52, '2026-09-12'],
  ] as const) {
    const preview = await previewOutputStock(f.ctx, { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: date, kind: 'production_draw', wetMassKg: wet, moisturePercent: moisture });
    const productInput = { code: `E2E-FIFO-${index}-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: date,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id, massKg: wet + ingredientWet, moistureContentPercent: moisture, waterAddedKg: 0,
      idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint,
      composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg: ingredientWet, moistureContentPercent: ingredientMoisture, moistureSource: 'operator_override' }] } };
    const product = await createBiocharProduct(f.ctx, productInput);
    expect((await createBiocharProduct(f.ctx, productInput)).id).toBe(product.id);
  }
  const order = await createOrder(f.ctx, { code: `E2E-FIFO-O-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id, formulationId: f.recipe.id, orderDate: new Date('2026-09-12'), quantityKg: 5000, packaging: 'loose' });
  const input = { storageLocationId: f.bin.id, facilityId: f.facility.id, physicalDate: '2026-09-14', kind: 'delivery' as const, wetMassKg: 2000, moisturePercent: 30 };
  const preview = await previewOutputStock(f.ctx, input);
  const deliveryInput = { code: `E2E-FIFO-D-${f.tag}`, orderId: order.id, facilityId: f.facility.id, deliveryDate: new Date('2026-09-14'), storageLocationId: f.bin.id, deliveredWetMassKg: 2000, moistureContentPercent: 30, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint };
  return { ...f, order, input, preview, deliveryInput };
}
async function post(f: { ctx: Awaited<ReturnType<typeof fixture>>['ctx'] }, input: OutputStockPreviewInput) {
  const preview = await previewOutputStock(f.ctx, input);
  return postOutputStock(f.ctx, { ...input, basisFingerprint: preview.basisFingerprint, idempotencyKey: randomUUID(), reason: 'E2E measured stock' });
}
describe('output FIFO transactions', () => {
  it('posts A900+B250, conserves wet/run sums and retries without duplicate effects', async () => {
    const f = await fixture();
    expect(f.preview.removedDryKg).toBe(1150);
    expect(f.preview.allocations.map(a => a.dryMassKg)).toEqual([900, 250]);
    const delivery = await createDelivery(f.ctx, f.deliveryInput);
    const retry = await createDelivery(f.ctx, f.deliveryInput);
    expect(retry.id).toBe(delivery.id);
    expect(delivery.massDryKg).toBe(1150);
    const allocations = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    expect(allocations.reduce((sum, a) => sum + Number(a.wetMassKg), 0)).toBe(2000);
    expect(allocations.reduce((sum, a) => sum + Number(a.dryMassKg), 0)).toBe(1150);
    for (const a of allocations) {
      const runs = await db.select().from(outputStockRunAllocations).where(eq(outputStockRunAllocations.allocationId, a.id));
      expect(runs.reduce((sum, r) => sum + Number(r.dryMassKg), 0)).toBe(Number(a.dryMassKg));
      expect(a.basisSnapshot.solidsKg).toBeTruthy();
    }
    await expect(createDelivery(f.ctx, { ...f.deliveryInput, deliveredWetMassKg: 1900 })).rejects.toThrow('different values');
    await expect(updateDelivery(f.ctx, delivery.id, { deliveredWetMassKg: 1900 })).rejects.toThrow('Correct entry');
    await expect(deleteDelivery(f.ctx, delivery.id)).rejects.toThrow('history');
    const [recorded] = await db.select({ wet: sql<number>`sum(${biocharProducts.massKg})`.mapWith(Number) }).from(biocharProducts).where(eq(biocharProducts.storageLocationId, f.bin.id));
    expect(recorded.wet).toBe(2500);
  });
  it('serializes delivery versus loss, rejects stale preview and leaves no partial ledger', async () => {
    const f = await fixture();
    const loss = { ...f.input, kind: 'loss' as const, wetMassKg: 1000 };
    const preview = await previewOutputStock(f.ctx, loss);
    const results = await Promise.allSettled([createDelivery(f.ctx, f.deliveryInput), postOutputStock(f.ctx, { ...loss, reason: 'E2E competing loss', idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    await expect(createDelivery(f.ctx, { ...f.deliveryInput, idempotencyKey: randomUUID() })).rejects.toThrow();
    const rows = await db.select().from(binMovements).where(and(eq(binMovements.storageLocationId, f.bin.id), eq(binMovements.organizationId, f.ctx.organizationId)));
    expect(rows).toHaveLength(1);
  });
  it('records no-loss counts and excess observations, closes zero exactly, and restores only original provenance', async () => {
    const f = await fixture();
    await createDelivery(f.ctx, f.deliveryInput);
    const base = { ...f.input, kind: 'count' as const, wetMassKg: 600 };
    expect((await post(f, base)).preview.removedDryKg).toBe(0);
    expect((await post(f, { ...base, wetMassKg: 700 })).preview.removedDryKg).toBe(0);
    const loss = await post(f, { ...base, kind: 'loss', wetMassKg: 120 });
    expect(loss.preview.removedDryKg).toBe(70);
    expect(loss.preview.afterDryKg).toBe(280);
    const correction = await post(f, { ...base, kind: 'loss', wetMassKg: 12, correctsMovementId: loss.movementId });
    expect(correction.preview.afterDryKg).toBe(343);
    const zero = await post(f, { ...base, wetMassKg: 0, moisturePercent: undefined });
    expect(zero.preview.removedDryKg).toBe(343);
    await expect(post(f, { ...base, kind: 'loss', wetMassKg: 6, correctsMovementId: correction.movementId })).rejects.toThrow('later');
  });
  it('rejects shortages, physically future sources, organization and formulation forgery; orders need no stock and bins are unpaginated', async () => {
    const f = await fixture();
    expect((await previewOutputStock(f.ctx, { ...f.input, wetMassKg: 2500, moisturePercent: 15 })).blockingMessage).toMatch(/Insufficient/);
    expect((await previewOutputStock(f.ctx, { ...f.input, physicalDate: '2026-09-10', wetMassKg: 1500, moisturePercent: 15 })).blockingMessage).toMatch(/Insufficient/);
    await expect(previewOutputStock({ ...f.ctx, organizationId: 'other-org' }, f.input)).rejects.toThrow('not found');
    const bins = await db.insert(storageLocations).values(Array.from({ length: 24 }, (_, i) => ({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, code: `E2E-FIFO-E${i}-${f.tag}`, name: `E2E Empty ${i} ${f.tag}`, type: 'product_bin' as const, formulationId: f.pure.id }))).returning();
    const emptyOrder = await createOrder(f.ctx, { code: `E2E-FIFO-EMPTY-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id, formulationId: f.pure.id, orderDate: new Date('2026-09-14'), quantityKg: 100, packaging: 'loose' });
    expect(emptyOrder.formulationId).toBe(f.pure.id);
    expect(await getMatchingOutputBins(f.ctx, { facilityId: f.facility.id, formulationId: f.pure.id })).toHaveLength(bins.length);
    await expect(createDelivery(f.ctx, { ...f.deliveryInput, orderId: emptyOrder.id, deliveredWetMassKg: 50 })).rejects.toThrow('matching');
  });
  it('reduces a loss on its original run after an older intake, with no debit to the late run', async () => {
    const f = await seedOutputStockParents(db);
    fixtureOrganizations.push(f.ctx.organizationId);
    const input = { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: '2026-09-14', kind: 'loss' as const, wetMassKg: 100, moisturePercent: 0 };
    const loss = await post(f, input);
    const [late] = await db.insert(productionRuns).values({ ...f.runs[0], id: randomUUID(), code: `E2E-FIFO-LATE-${f.tag}`, stockPostingSequence: undefined,
      startTime: new Date('2026-09-08T08:00:00Z'), endTime: new Date('2026-09-08T12:00:00Z'), biocharOutputKg: 100, biocharDryMassKg: 100, biocharMoisturePercent: 0 }).returning();
    const corrected = await post(f, { ...input, wetMassKg: 10, correctsMovementId: loss.movementId });
    expect(corrected.preview.allocations.map(a => [a.layerId, a.dryMassKg])).toEqual([[f.runs[0].id, 10]]);
    const lateDebits = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.productionRunId, late.id));
    expect(lateDebits).toHaveLength(0);
    expect(corrected.preview.afterDryKg).toBe(1590);
    const history = await getOutputStockHistory(f.ctx, f.source.id);
    expect(history.find(e => e.id === loss.movementId)?.actorName).toBe('E2E FIFO operator');
    expect(history.find(e => e.id === corrected.movementId)?.eventKind).toBe('loss');
    expect(history.filter(e => e.kind === 'reversal').map(e => e.dryMassKg)).toEqual([-100]);
  });
  it('explicit unused delivery correction may allocate a late physically older product without replaying saved history', async () => {
    const f = await fixture();
    const delivery = await createDelivery(f.ctx, f.deliveryInput);
    const [late] = await db.insert(productionRuns).values({ ...f.runs[0], id: randomUUID(), code: `E2E-FIFO-LATE-${f.tag}`, stockPostingSequence: undefined,
      startTime: new Date('2026-09-07T08:00:00Z'), endTime: new Date('2026-09-07T12:00:00Z'), biocharOutputKg: 100, biocharDryMassKg: 100, biocharMoisturePercent: 0 }).returning();
    const source = { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: '2026-09-08', kind: 'production_draw' as const, wetMassKg: 100, moisturePercent: 0 };
    const preview = await previewOutputStock(f.ctx, source);
    expect(preview.allocations[0].layerId).toBe(late.id);
    const product = await createBiocharProduct(f.ctx, { code: `E2E-FIFO-LATE-P-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: source.physicalDate,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id, massKg: 100, moistureContentPercent: 0, waterAddedKg: 0,
      idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint,
      composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg: 0, moistureContentPercent: 0, moistureSource: 'operator_override' }] } });
    const originals = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    expect(originals.map(a => Number(a.dryMassKg)).sort((a,b) => b-a)).toEqual([900, 250]);
    const corrected = await post(f, { ...f.input, physicalDate: '2026-09-15', correctsMovementId: originals[0].movementId });
    expect(corrected.preview.allocations[0]).toMatchObject({ layerId: product.id, dryMassKg: 100 });
    const [saved] = await db.select().from(deliveries).where(eq(deliveries.id, delivery.id));
    expect(saved.deliveryDate.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    const history = await getOutputStockHistory(f.ctx, f.bin.id);
    expect(history.filter(e => e.kind === 'intake').map(e => e.wetMassKg)).toEqual([1500, 1000, 100]);
  });
  it('blocks a restored older layer from invalidating a later newer-layer draw and a count observation', async () => {
    const f = await seedOutputStockParents(db);
    fixtureOrganizations.push(f.ctx.organizationId);
    const input = { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: '2026-09-14', kind: 'loss' as const, wetMassKg: 900, moisturePercent: 0 };
    const first = await post(f, input);
    await post(f, { ...input, wetMassKg: 100 });
    await expect(post(f, { ...input, wetMassKg: 800, correctsMovementId: first.movementId })).rejects.toThrow('later');
    const count = await post(f, { ...input, kind: 'count', wetMassKg: 500 });
    await post(f, { ...input, wetMassKg: 100 });
    await expect(post(f, { ...input, kind: 'count', wetMassKg: 400, correctsMovementId: count.movementId })).rejects.toThrow('later');
  });

  it('retains wet residual provenance when an earlier layer has already attributed its last dry gram', async () => {
    const f = await seedOutputStockParents(db);
    fixtureOrganizations.push(f.ctx.organizationId);
    const [bin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, formulationId: f.pure.id, code: `E2E-FIFO-TINY-${f.tag}`, name: 'E2E tiny stock', type: 'product_bin' }).returning();
    const products: Awaited<ReturnType<typeof createBiocharProduct>>[] = [];
    for (const [index, massKg] of [0.001, 0.002].entries()) {
      const input = { storageLocationId: f.source.id, facilityId: f.facility.id, physicalDate: '2026-09-14', kind: 'production_draw' as const, wetMassKg: massKg, moisturePercent: 0 };
      const preview = await previewOutputStock(f.ctx, input);
      products.push(await createBiocharProduct(f.ctx, { code: `E2E-FIFO-TINY-P${index}-${f.tag}`, facilityId: f.facility.id, formulationId: f.pure.id, placedAt: input.physicalDate,
        sourceBiocharStorageLocationId: f.source.id, storageLocationId: bin.id, massKg, moistureContentPercent: 0, waterAddedKg: 0, composition: {}, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint }));
    }
    const order = await createOrder(f.ctx, { code: `E2E-FIFO-TINY-O-${f.tag}`, facilityId: f.facility.id, customerId: f.customer.id, formulationId: f.pure.id, orderDate: new Date('2026-09-14'), quantityKg: 1, packaging: 'loose' });
    let lastDelivery;
    for (const [index, wet, moisture] of [[0, 0.001, 40], [1, 0.004, 60]] as const) {
      const input = { storageLocationId: bin.id, facilityId: f.facility.id, physicalDate: '2026-09-14', kind: 'delivery' as const, wetMassKg: wet, moisturePercent: moisture };
      const preview = await previewOutputStock(f.ctx, input);
      lastDelivery = await createDelivery(f.ctx, { code: `E2E-FIFO-TINY-D${index}-${f.tag}`, facilityId: f.facility.id, orderId: order.id, storageLocationId: bin.id, deliveryDate: new Date('2026-09-14'),
        deliveredWetMassKg: wet, moistureContentPercent: moisture, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint });
    }
    const shares = await getDeliveryAllocationProvenance(f.ctx, [lastDelivery!.id]);
    expect(shares.find(s => s.biocharProductId === products[0].id)).toMatchObject({ dryMassKg: 0, wetMassKg: 0.001 });
    expect(shares.find(s => s.biocharProductId === products[1].id)).toMatchObject({ dryMassKg: 0.001, wetMassKg: 0.003 });
    expect(shares.reduce((sum, s) => sum + s.wetMassKg, 0)).toBe(0.004);
  });

});
