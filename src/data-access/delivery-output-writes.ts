import { db } from '@/db';
import { deliveries, drivers, facilities, orders, storageLocations, vehicles, type Delivery } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { formatUtcDate } from '@/lib/date-utils';
import { SafeError } from '@/lib/errors';
import { createDeliverySchema, updateDeliverySchema } from '@/schemas/deliveries';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { assertCanMutateCertifiedLineage } from './certification-lineage-guards';
import { lockDeliveryOrderAndAssertBalance } from './delivery-order-balance';
import { lockBinStock } from './lock-bin-stocks';
import { getOutputStockAllocationProjection } from './output-stock';
import { withOutputStockPosting } from './output-stock-post';
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs } from './transport-legs';
import { assertSameOrg, requireOrgScope } from './utils';

export async function createDelivery(ctx: OrgContext, raw: z.input<typeof createDeliverySchema>): Promise<Delivery> {
  requireOrgScope(ctx);
  const data = createDeliverySchema.parse(raw);
  const input = { storageLocationId: data.storageLocationId, facilityId: data.facilityId, physicalDate: formatUtcDate(data.deliveryDate), kind: 'delivery' as const,
    wetMassKg: data.deliveredWetMassKg!, moisturePercent: data.moistureContentPercent, basisFingerprint: data.basisFingerprint, idempotencyKey: data.idempotencyKey, reason: `Delivery ${data.code}` };
  const payload = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'code'));
  if (data.driverId) await assertSameOrg(ctx, drivers, data.driverId);
  if (data.vehicleId) await assertSameOrg(ctx, vehicles, data.vehicleId);
  return withOutputStockPosting(ctx, { input, payload, locksTransportRoutes: true, replay: async (tx, existing) => {
      const [delivery] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, String(existing.inputSnapshot?.deliveryId))));
      if (!delivery) throw new SafeError('Posted delivery not found');
      return delivery;
    }, write: async (tx, post) => {
    const [facility] = await tx.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, data.facilityId), isNull(facilities.archivedAt))).for('share');
    if (!facility) throw new SafeError('Facility not found or archived');
    await lockDeliveryOrderAndAssertBalance(ctx, tx, { orderId: data.orderId, requestedWetKg: data.deliveredWetMassKg });
    const [order] = await tx.select().from(orders).where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, data.orderId), eq(orders.facilityId, data.facilityId), isNull(orders.archivedAt)));
    const [bin] = await tx.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, data.storageLocationId), eq(storageLocations.facilityId, data.facilityId), eq(storageLocations.type, 'product_bin'), isNull(storageLocations.archivedAt)));
    if (!order || !bin || bin.formulationId !== order.formulationId) throw new SafeError('Choose a source bin matching the order formulation and facility.');
    await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'order', entityId: order.id }, 'create');
    const [delivery] = await tx.insert(deliveries).values({ organizationId: ctx.organizationId, code: data.code, orderId: data.orderId, facilityId: data.facilityId,
      storageLocationId: data.storageLocationId, deliveryDate: data.deliveryDate, status: 'delivered', deliveredWetMassKg: data.deliveredWetMassKg,
      moistureContentPercent: data.moistureContentPercent, driverId: data.driverId, vehicleId: data.vehicleId,
      distanceKmOverride: data.distanceKmOverride, distanceSource: data.distanceSource, distanceNote: data.distanceNote, tripType: data.tripType ?? 'return' }).returning();
    const posted = await post({ deliveryId: delivery.id });
    const [saved] = await tx.update(deliveries).set({ massDryKg: posted.preview.removedDryKg }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, delivery.id))).returning();
    await syncBiocharProductTransportLegs(ctx, tx, posted.preview.allocations.map(a => a.layerId));
    return saved;
  } });
}
export async function updateDelivery(ctx: OrgContext, deliveryId: string, raw: Omit<z.input<typeof updateDeliverySchema>, 'deliveryId'>): Promise<Delivery> {
  requireOrgScope(ctx);
  const data = updateDeliverySchema.parse({ ...raw, deliveryId });
  if (data.driverId) await assertSameOrg(ctx, drivers, data.driverId);
  if (data.vehicleId) await assertSameOrg(ctx, vehicles, data.vehicleId);
  return db.transaction(async tx => {
    await lockBiocharTransportRouteTopology(ctx, tx);
    const [existing] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId)));
    if (!existing) throw new SafeError('Delivery not found');
    await lockBinStock(ctx, tx, existing.storageLocationId);
    await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: deliveryId }, 'update');
    for (const key of ['orderId', 'facilityId', 'storageLocationId', 'deliveredWetMassKg', 'moistureContentPercent'] as const) {
      if (data[key] !== undefined && data[key] !== existing[key]) throw new SafeError('Use Correct entry in bin history and enter a reason to change posted stock.');
    }
    if (data.deliveryDate && data.deliveryDate.getTime() !== existing.deliveryDate.getTime()) throw new SafeError('Use Correct entry in bin history to change the physical date.');
    const [saved] = await tx.update(deliveries).set({ code: data.code, driverId: data.driverId, vehicleId: data.vehicleId, distanceKmOverride: data.distanceKmOverride,
      distanceSource: data.distanceSource, distanceNote: data.distanceNote, tripType: data.tripType ?? undefined, updatedAt: new Date() }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId))).returning();
    const rows = await getOutputStockAllocationProjection(ctx, { deliveryId }, tx);
    await syncBiocharProductTransportLegs(ctx, tx, [...new Set(rows.flatMap(r => r.allocation.biocharProductId ? [r.allocation.biocharProductId] : []))]);
    return saved;
  });
}
export async function deleteDelivery(ctx: OrgContext, deliveryId: string): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(async tx => {
    await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: deliveryId }, 'delete');
    const [row] = await tx.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId)));
    if (!row) throw new SafeError('Delivery not found');
    throw new SafeError('Posted deliveries retain their history. Use Correct entry in bin history.');
  });
}
