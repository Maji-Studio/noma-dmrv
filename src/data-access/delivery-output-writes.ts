/**
 * Delivery create lock order: organization route topology, movement request
 * (replay exits without writes), sorted advisory bin locks, lineage artifact
 * union discovered before row locks, active facility FOR SHARE, order FOR
 * UPDATE and wet balance, then lineage revalidation without acquiring new
 * artifacts. Read the order unlocked to discover its facility and zone and
 * revalidate that relationship under the order lock.
 * Products remain locked by post after inserting the delivery. The facility
 * lock serializes archive/unarchive (facility, deliveries/products, orders),
 * so archive cannot hold a product while this writer holds its facility.
 * Topology serializes order writes, delivery updates and corrections; sorted
 * bins serialize product placement before its facility and product row locks. Bin locks are advisory, not row locks.
 * Application create takes artifacts first, then its delivery row, then FK
 * key-share locks on products and runs. It takes no topology or bin lock;
 * create never locks an existing delivery, so these writers cannot cycle.
 */
import { assertRowVersion, nextVersion } from "./row-version";
import { randomUUID } from 'node:crypto';
import { db, type DbTransaction } from '@/db';
import { biocharProducts, outputStockAllocations, deliveries, drivers, facilities, orders, storageLocations, vehicles, type BiocharProduct, type BiocharProductRecord, type Delivery } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { updateDeliverySchema, resolveDeliveryDistanceSource } from '@/schemas/deliveries';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { assertLockedLineagesAllowMutation, lockCertifiedLineageArtifacts, assertCanMutateCertifiedLineage } from './certification-lineage-guards';
import { lockDeliveryOrderAndAssertBalance } from './delivery-order-balance';
import { lockBinStock } from './lock-bin-stocks';
import { getOutputStockAllocationProjection } from './output-stock';
import { withOutputStockPostingInTransaction, findPostedOutputRequest, OUTPUT_STOCK_FUTURE_TIME_MESSAGE, type PostedOutputRequest, type OutputStockPostingOptions, recordOutputStockMovementInTransaction } from './output-stock-post';
import { lockMovementRequest } from './bin-movement-requests';
import { assertLatestOutputMovement } from './output-stock-edit-lock';
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs } from './transport-legs';
import { requireOrgScope } from './utils';

import { recordDeliveryInput, type RecordDeliveryInput } from '@/schemas/delivery-input';
import { deliveryReferenceNotFound, deliveryValidationFailed } from '@/lib/delivery-domain-errors';
import { withOutputStockErrors } from '@/lib/output-stock-domain-errors';
import { withFeedstockErrors } from '@/lib/feedstock-domain-errors';
import { resolveEventInstant } from '@/lib/operations/event-times';
import { rationalToNumber, readRational } from '@/lib/output-stock';
import { assertEventTimesNotFuture } from './future-event-time';
import { lockActiveFacilityReference } from './facility-reference-guards';
import { withAutoCodes, withUniqueCodeGuard, CODE_CONFLICT_MESSAGES } from './code-generator';

export type CreatedDelivery = Delivery & { savedProducts: BiocharProduct[] };
/** A mass or moisture edit re-posts stock, so the products it touched return with their new versions. */
export type UpdatedDelivery = Delivery & { savedProducts: BiocharProductRecord[] };

export interface CreateDeliveryInput extends RecordDeliveryInput {
  idempotencyKey: string;
  /** App-only custom code. API creates always generate it. */
  code?: string;
}
export interface CreateDeliveryOptions extends OutputStockPostingOptions { now?: Date }

async function deliveryAllocations(ctx: OrgContext, tx: DbTransaction, movement: PostedOutputRequest) {
  requireOrgScope(ctx);
  const rows = await tx.select().from(outputStockAllocations).where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.movementId, movement.id)));
  const preview = movement.inputSnapshot?.preview as { allocations: { layerId: string }[] } | undefined;
  const order = preview?.allocations.map(allocation => allocation.layerId) ?? [];
  rows.sort((a, b) => order.indexOf(a.biocharProductId!) - order.indexOf(b.biocharProductId!));
  return rows.map(row => ({ layerId: row.biocharProductId!, code: String(row.basisSnapshot.code),
    dryBiocharKg: Number(row.dryMassKg), solidsKg: rationalToNumber(readRational(row.basisSnapshot.solidsKg)),
    wetKg: row.wetMassKg === null ? null : Number(row.wetMassKg),
    moisturePercent: row.basisSnapshot.readingPercent == null ? null : Number(row.basisSnapshot.readingPercent),
    policy: row.basisSnapshot.policy as "fifo" | "lifo" | "pro_rata" | "operator_order" }));
}

async function replayDelivery(ctx: OrgContext, tx: DbTransaction, movement: PostedOutputRequest) {
  requireOrgScope(ctx);
  const [delivery] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, String(movement.inputSnapshot?.deliveryId))));
  if (!delivery) throw deliveryReferenceNotFound(['orderId'], 'Posted delivery');
  return { delivery: { ...delivery, savedProducts: [] as BiocharProduct[] }, basisFingerprint: movement.basisFingerprint!, allocations: await deliveryAllocations(ctx, tx, movement) };
}

/** All reference reads and code-generation savepoints use the caller's connection. */
export async function createDeliveryInTransaction(ctx: OrgContext, tx: DbTransaction, raw: CreateDeliveryInput, options: CreateDeliveryOptions = {}) {
  requireOrgScope(ctx);
  const { code, idempotencyKey, ...facts } = raw;
  const data = recordDeliveryInput.parse(facts);
  const payload = { ...data, idempotencyKey };
  return withOutputStockErrors(async () => {
    await lockBiocharTransportRouteTopology(ctx, tx);
    const committed = await findPostedOutputRequest(ctx, tx, { idempotencyKey, payload, storageLocationId: data.storageLocationId });
    if (committed) return replayDelivery(ctx, tx, committed);
    const [orderRead] = await tx.select().from(orders).where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, data.orderId)));
    if (!orderRead || orderRead.archivedAt) throw deliveryReferenceNotFound(['orderId'], 'Order');
    const [facilityRead] = await tx.select().from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, orderRead.facilityId)));
    if (!facilityRead || facilityRead.archivedAt) throw deliveryReferenceNotFound(['orderId'], 'Order facility');
    const deliveredAt = resolveEventInstant(data.deliveredAt, facilityRead.timezone, ['deliveredAt']);
    assertEventTimesNotFuture({ deliveredAt }, { deliveredAt: OUTPUT_STOCK_FUTURE_TIME_MESSAGE }, options.now ?? new Date());
    const [binRead] = await tx.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, data.storageLocationId)));
    if (!binRead || binRead.archivedAt) throw deliveryReferenceNotFound(['storageLocationId'], 'Source bin');
    for (const [field, table] of [['driverId', drivers], ['vehicleId', vehicles]] as const) {
      if (data[field]) {
        const [reference] = await tx.select({ id: table.id }).from(table).where(and(eq(table.organizationId, ctx.organizationId), eq(table.id, data[field]!)));
        if (!reference) throw deliveryReferenceNotFound([field], field === 'driverId' ? 'Driver' : 'Vehicle');
      }
    }
    const insert = (deliveryCode: string, writeTx: DbTransaction) => withOutputStockPostingInTransaction(ctx, writeTx, {
      input: { storageLocationId: data.storageLocationId, facilityId: orderRead.facilityId, occurredAt: deliveredAt.toISOString(), kind: 'delivery',
        wetMassKg: data.deliveredWetMassKg, moisturePercent: data.moisturePercent, sources: data.sources, basisFingerprint: data.basisFingerprint, idempotencyKey, reason: `Delivery ${deliveryCode}` },
      payload, locksTransportRoutes: true, replay: (replayTx, movement) => replayDelivery(ctx, replayTx, movement),
      write: async (postingTx, post) => {
        const target = { entityType: 'order' as const, entityId: data.orderId };
        const keys = await withFeedstockErrors(() => lockCertifiedLineageArtifacts(ctx, postingTx, [target]), 'certification_locked', ['orderId']);
        await withFeedstockErrors(() => lockActiveFacilityReference(ctx, postingTx, orderRead.facilityId), 'not_found', ['orderId']);
        const [lockedFacility] = await postingTx.select({ timezone: facilities.timezone }).from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, orderRead.facilityId)));
        if (typeof data.deliveredAt === 'object' && !(data.deliveredAt instanceof Date) && lockedFacility.timezone !== facilityRead.timezone) throw deliveryValidationFailed(['deliveredAt'], 'Facility time zone changed. Refresh and retry.');
        const [order] = await postingTx.select().from(orders).where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, data.orderId))).for('update');
        if (!order || order.archivedAt) throw deliveryReferenceNotFound(['orderId'], 'Order');
        if (order.facilityId !== orderRead.facilityId) throw deliveryValidationFailed(['orderId'], 'Order facility changed. Refresh and retry.');
        const [bin] = await postingTx.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, data.storageLocationId)));
        if (!bin || bin.archivedAt) throw deliveryReferenceNotFound(['storageLocationId'], 'Source bin');
        if (bin.type !== 'product_bin') throw deliveryValidationFailed(['storageLocationId'], 'Choose a product bin.');
        if (bin.facilityId !== order.facilityId) throw deliveryValidationFailed(['storageLocationId'], 'Source bin is in another facility.');
        if (bin.formulationId !== order.formulationId) throw deliveryValidationFailed(['storageLocationId'], 'Source bin holds another formulation.');
        for (const [index, source] of (data.sources ?? []).entries()) {
          const path = ['sources', index, 'layerId'];
          const [product] = await postingTx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, source.layerId)));
          if (!product) throw deliveryReferenceNotFound(path, 'Product');
          if (product.storageLocationId !== data.storageLocationId) throw deliveryValidationFailed(path, 'Product is in another bin.');
          if (!product.placedAt || product.placedAt > deliveredAt) throw deliveryValidationFailed(path, 'Product was placed after this delivery.');
        }
        await lockDeliveryOrderAndAssertBalance(ctx, postingTx, { orderId: order.id, requestedWetKg: data.deliveredWetMassKg });
        await withFeedstockErrors(() => assertLockedLineagesAllowMutation(ctx, postingTx, keys, [{ target, mutation: 'create' }]), 'certification_locked', ['orderId']);
        const [delivery] = await postingTx.insert(deliveries).values({ organizationId: ctx.organizationId, code: deliveryCode, orderId: order.id, facilityId: order.facilityId,
          storageLocationId: data.storageLocationId, deliveryDate: deliveredAt, status: 'delivered', deliveredWetMassKg: data.deliveredWetMassKg,
          moistureContentPercent: data.moisturePercent, driverId: data.driverId, vehicleId: data.vehicleId,
          distanceKmOverride: data.distanceKmOverride ?? null, distanceSource: resolveDeliveryDistanceSource(data.distanceKmOverride ?? null, data.distanceSource), distanceNote: data.distanceNote || null }).returning();
        const posted = await post({ deliveryId: delivery.id });
        const [saved] = await postingTx.update(deliveries).set({ version: nextVersion(deliveries.version), massDryKg: posted.preview.removedDryKg, moistureContentPercent: posted.moisturePercent }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, delivery.id))).returning();
        await syncBiocharProductTransportLegs(ctx, postingTx, posted.preview.allocations.map(a => a.layerId));
        return { delivery: { ...saved, savedProducts: posted.savedProducts }, basisFingerprint: posted.preview.basisFingerprint, allocations: await deliveryAllocations(ctx, postingTx, posted.movement) };
      },
    }, options).catch(async (error: unknown) => {
      // Archive can finish between the unlocked discovery and the bin guard.
      // Its facility refusal still points at the only parent the caller sent.
      if (error instanceof SafeError) {
        const [facility] = await writeTx.select({ archivedAt: facilities.archivedAt }).from(facilities)
          .where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, orderRead.facilityId)));
        if (facility?.archivedAt) throw deliveryReferenceNotFound(['orderId'], 'Order facility');
      }
      throw error;
    });
    return code
      ? withUniqueCodeGuard(ctx, deliveries, deliveries.code, CODE_CONFLICT_MESSAGES.delivery, () => tx.transaction(savepoint => insert(code, savepoint)))
      : withAutoCodes(ctx, tx, 'DL', deliveries, deliveries.code, 1, (codes, savepoint) => insert(codes[0], savepoint), CODE_CONFLICT_MESSAGES.delivery);
  }, { shortage: ['deliveredWetMassKg'], validation: ['storageLocationId'] });
}

export async function updateDeliveryInTransaction(ctx: OrgContext, tx: DbTransaction, deliveryId: string, raw: Omit<z.input<typeof updateDeliverySchema>, 'deliveryId'>): Promise<UpdatedDelivery> {
  requireOrgScope(ctx);
  return withUniqueCodeGuard(ctx, deliveries, deliveries.code, CODE_CONFLICT_MESSAGES.delivery, async () => {
    const data = updateDeliverySchema.parse({ ...raw, deliveryId });
    for (const [field, table] of [['driverId', drivers], ['vehicleId', vehicles]] as const) {
      if (data[field]) {
        const [reference] = await tx.select({ id: table.id }).from(table).where(and(eq(table.organizationId, ctx.organizationId), eq(table.id, data[field]!)));
        if (!reference) throw deliveryReferenceNotFound([field], field === 'driverId' ? 'Driver' : 'Vehicle');
      }
    }
    await lockBiocharTransportRouteTopology(ctx, tx);
    const requestKey = data.idempotencyKey ?? randomUUID();
    await lockMovementRequest(ctx, tx, requestKey);
    const [snapshot] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId)));
    if (!snapshot || snapshot.archivedAt) throw deliveryReferenceNotFound(['deliveryId'], 'Delivery');
    // Topology, request, bin, artifacts, active facility, delivery.
    await withFeedstockErrors(() => lockBinStock(ctx, tx, snapshot.storageLocationId), 'not_found', ['deliveryId']);
    await withFeedstockErrors(() => assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: deliveryId }, 'update'), 'certification_locked', ['deliveryId']);
    await withFeedstockErrors(() => lockActiveFacilityReference(ctx, tx, snapshot.facilityId), 'not_found', ['deliveryId']);
    const [existing] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId))).for('update');
    if (!existing || existing.archivedAt) throw deliveryReferenceNotFound(['deliveryId'], 'Delivery');
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
    let savedProducts: BiocharProductRecord[] = [];
    const sourcesChanged = data.sources !== undefined && JSON.stringify(data.sources) !== JSON.stringify(current?.inputSnapshot?.sources);
    if (massChanged || moistureChanged || sourcesChanged) {
      if (!current) throw new SafeError('Posted delivery stock entry not found.');
      await assertLatestOutputMovement(ctx, existing.storageLocationId, current.id, tx);
      if (data.correctsMovementId && data.correctsMovementId !== current.id) throw new SafeError('This delivery was corrected. Reload it before editing its mass.');
      const savedSources = current.inputSnapshot?.sources;
      if (moistureChanged && data.sources === undefined && Array.isArray(savedSources)) throw new SafeError('Edit the moisture reading for each sub-bin in this delivery.');
      ({ savedProducts } = await recordOutputStockMovementInTransaction(ctx, tx, {
        storageLocationId: existing.storageLocationId, facilityId: existing.facilityId, kind: 'delivery',
        occurredAt: existing.deliveryDate.toISOString(), wetMassKg: data.deliveredWetMassKg === undefined ? existing.deliveredWetMassKg! : data.deliveredWetMassKg!,
        moisturePercent: data.moistureContentPercent ?? existing.moistureContentPercent, sources: data.sources,
        correctsMovementId: current.id, idempotencyKey: requestKey, basisFingerprint: data.basisFingerprint,
        reason: `Delivery ${data.code ?? existing.code}: mass or moisture edited`,
      }, { requireLatestCorrection: true }));
    }
    const [saved] = await tx.update(deliveries).set({ version: nextVersion(deliveries.version), code: data.code, driverId: data.driverId, vehicleId: data.vehicleId, distanceKmOverride: data.distanceKmOverride,
      distanceSource: resolveDeliveryDistanceSource(data.distanceKmOverride === undefined && data.distanceSource !== undefined ? existing.distanceKmOverride : data.distanceKmOverride, data.distanceSource), distanceNote: data.distanceNote === '' ? null : data.distanceNote, updatedAt: new Date() }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId))).returning();
    const savedRows = await getOutputStockAllocationProjection(ctx, { deliveryId }, tx);
    await syncBiocharProductTransportLegs(ctx, tx, [...new Set(savedRows.flatMap(r => r.allocation.biocharProductId ? [r.allocation.biocharProductId] : []))]);
    return { ...saved, savedProducts };
  });
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
