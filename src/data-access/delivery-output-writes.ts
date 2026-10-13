import { assertRowVersion, nextVersion } from "./row-version";
import { randomUUID } from 'node:crypto';
import { db, type DbTransaction } from '@/db';
import { deliveries, drivers, facilities, orders, storageLocations, vehicles, type BiocharProduct, type Delivery } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { createDeliverySchema, updateDeliverySchema } from '@/schemas/deliveries';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { assertCanMutateCertifiedLineage } from './certification-lineage-guards';
import { lockDeliveryOrderAndAssertBalance } from './delivery-order-balance';
import { lockBinStock } from './lock-bin-stocks';
import { getOutputStockAllocationProjection } from './output-stock';
import { withOutputStockPosting, recordOutputStockMovementInTransaction } from './output-stock-post';
import { lockMovementRequest } from './bin-movement-requests';
import { assertLatestOutputMovement } from './output-stock-edit-lock';
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs } from './transport-legs';
import { assertSameOrg, requireOrgScope } from './utils';

export type CreatedDelivery = Delivery & { savedProducts: BiocharProduct[] };

export async function createDelivery(ctx: OrgContext, raw: z.input<typeof createDeliverySchema>): Promise<CreatedDelivery> {
  requireOrgScope(ctx);
  const data = createDeliverySchema.parse(raw);
  const input = { storageLocationId: data.storageLocationId, facilityId: data.facilityId, occurredAt: data.deliveryDate.toISOString(), kind: 'delivery' as const,
    wetMassKg: data.deliveredWetMassKg!, moisturePercent: data.moistureContentPercent, sources: data.sources, basisFingerprint: data.basisFingerprint, idempotencyKey: data.idempotencyKey, reason: `Delivery ${data.code}` };
  const payload = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'code'));
  if (data.driverId) await assertSameOrg(ctx, drivers, data.driverId);
  if (data.vehicleId) await assertSameOrg(ctx, vehicles, data.vehicleId);
  return withOutputStockPosting(ctx, { input, payload, locksTransportRoutes: true, replay: async (tx, existing) => {
      const [delivery] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, String(existing.inputSnapshot?.deliveryId))));
      if (!delivery) throw new SafeError('Posted delivery not found');
      // Replays write no products; the client invalidates their caches.
      return { ...delivery, savedProducts: [] };
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
      distanceKmOverride: data.distanceKmOverride, distanceSource: data.distanceSource, distanceNote: data.distanceNote }).returning();
    const posted = await post({ deliveryId: delivery.id });
    // A split-bin load stores its overall moisture, 1 − solids ÷ wet, from the per-sub-bin readings.
    const [saved] = await tx.update(deliveries).set({ version: nextVersion(deliveries.version), massDryKg: posted.preview.removedDryKg, moistureContentPercent: posted.moisturePercent }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, delivery.id))).returning();
    await syncBiocharProductTransportLegs(ctx, tx, posted.preview.allocations.map(a => a.layerId));
    return { ...saved, savedProducts: posted.savedProducts };
  } });
}
export async function updateDeliveryInTransaction(ctx: OrgContext, tx: DbTransaction, deliveryId: string, raw: Omit<z.input<typeof updateDeliverySchema>, 'deliveryId'>): Promise<Delivery> {
  requireOrgScope(ctx);
  const data = updateDeliverySchema.parse({ ...raw, deliveryId });
  if (data.driverId) await assertSameOrg(ctx, drivers, data.driverId, tx);
  if (data.vehicleId) await assertSameOrg(ctx, vehicles, data.vehicleId, tx);
  await lockBiocharTransportRouteTopology(ctx, tx);
  const requestKey = data.idempotencyKey ?? randomUUID();
  await lockMovementRequest(ctx, tx, requestKey);
  const [snapshot] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId)));
  if (!snapshot) throw new SafeError('Delivery not found');
  // Match stock posting and application creation: topology, request, bin, artifacts, delivery.
  await lockBinStock(ctx, tx, snapshot.storageLocationId);
  await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: deliveryId }, 'update');
  const [existing] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId))).for('update');
  if (!existing) throw new SafeError('Delivery not found');
  assertRowVersion({ entity: "delivery", id: deliveryId, expectedVersion: data.expectedVersion, actualVersion: existing.version });
  for (const key of ['orderId', 'facilityId', 'storageLocationId'] as const) {
    if (data[key] !== undefined && data[key] !== existing[key]) throw new SafeError('The order, facility and source bin of a posted delivery cannot be changed.');
  }
  if (data.deliveryDate && data.deliveryDate.getTime() !== existing.deliveryDate.getTime()) throw new SafeError('The date and time of a posted delivery cannot be changed. Edit its mass and moisture while it is the latest stock entry.');
  const rows = await getOutputStockAllocationProjection(ctx, { deliveryId }, tx);
  const reversedIds = new Set(rows.filter(r => r.movement.outputKind === 'reversal').map(r => r.movement.correctsMovementId));
  const current = rows.filter(r => r.movement.outputKind !== 'reversal' && !reversedIds.has(r.movement.id))
    .sort((a, b) => a.movement.postingSequence > b.movement.postingSequence ? -1 : 1)[0]?.movement;
  const massChanged = data.deliveredWetMassKg !== undefined && data.deliveredWetMassKg !== existing.deliveredWetMassKg;
  const moistureChanged = data.moistureContentPercent !== undefined && data.moistureContentPercent !== existing.moistureContentPercent;
  const sourcesChanged = data.sources !== undefined && JSON.stringify(data.sources) !== JSON.stringify(current?.inputSnapshot?.sources);
  if (massChanged || moistureChanged || sourcesChanged) {
    if (!current) throw new SafeError('Posted delivery stock entry not found.');
    await assertLatestOutputMovement(ctx, existing.storageLocationId, current.id, tx);
    if (data.correctsMovementId && data.correctsMovementId !== current.id) throw new SafeError('This delivery was corrected. Reload it before editing its mass.');
    const savedSources = current.inputSnapshot?.sources;
    if (moistureChanged && data.sources === undefined && Array.isArray(savedSources)) throw new SafeError('Edit the moisture reading for each sub-bin in this delivery.');
    await recordOutputStockMovementInTransaction(ctx, tx, {
      storageLocationId: existing.storageLocationId, facilityId: existing.facilityId, kind: 'delivery',
      occurredAt: existing.deliveryDate.toISOString(), wetMassKg: data.deliveredWetMassKg === undefined ? existing.deliveredWetMassKg! : data.deliveredWetMassKg!,
      moisturePercent: data.moistureContentPercent ?? existing.moistureContentPercent, sources: data.sources,
      correctsMovementId: current.id, idempotencyKey: requestKey, basisFingerprint: data.basisFingerprint,
      reason: `Delivery ${data.code ?? existing.code}: mass or moisture edited`,
    }, { requireLatestCorrection: true });
  }
  const [saved] = await tx.update(deliveries).set({ version: nextVersion(deliveries.version), code: data.code, driverId: data.driverId, vehicleId: data.vehicleId, distanceKmOverride: data.distanceKmOverride,
    distanceSource: data.distanceSource, distanceNote: data.distanceNote, updatedAt: new Date() }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId))).returning();
  const savedRows = await getOutputStockAllocationProjection(ctx, { deliveryId }, tx);
  await syncBiocharProductTransportLegs(ctx, tx, [...new Set(savedRows.flatMap(r => r.allocation.biocharProductId ? [r.allocation.biocharProductId] : []))]);
  return saved;
}
export async function deleteDelivery(ctx: OrgContext, deliveryId: string, expectedVersion: number): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(async tx => {
    await lockBiocharTransportRouteTopology(ctx, tx);
    await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: deliveryId }, 'delete');
    const [versionRow] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId))).for("update");
    if (!versionRow) throw new SafeError("Delivery not found");
    assertRowVersion({ entity: "delivery", id: deliveryId, expectedVersion: expectedVersion, actualVersion: versionRow.version });

    throw new SafeError("Posted deliveries retain their history and cannot be deleted. Edit mass and moisture while the delivery is the bin's latest stock entry.");
  });
}
