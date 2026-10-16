import { afterEach, beforeAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { activityEvents, biocharProducts, deliveries, orders } from '@/db/schema';
import { getOutputBinStockView } from '@/data-access/output-stock';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import { deleteDelivery } from '@/data-access/delivery-delete';
import { deleteBiocharProduct } from '@/data-access/biochar-product-delete';
import { deletePostedDelivery, updateDelivery } from '@/lib/operations/deliveries';
import { deletePostedBiocharProduct } from '@/lib/operations/biochar-products';
import { deleteOrder, updateOrder } from '@/lib/operations/orders';
import { runOperationInProcess } from '@/lib/operations/runner';
import { withLineageFixture } from './helpers/certification-lineage-fixture';
import { ensureTestOrg, makeTestOrgContext } from './helpers/test-org';
import { cleanupPostedStock, postedStockFixture, postDelivery, postMeasurement } from './helpers/posted-output-stock-fixture';

const fixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
beforeAll(() => ensureTestOrg());
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });
async function fixture() { const f = await postedStockFixture(); fixtures.push(f); return f; }

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
  expect(await db.select().from(biocharProducts).where(eq(biocharProducts.id, f.product!.id))).toHaveLength(0);
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
