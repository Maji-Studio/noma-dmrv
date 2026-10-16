import { DomainError } from '@/lib/domain-errors';
import { recordLocks, withRecordLockGuidance } from '@/lib/record-lock';
import { readRecordDependents } from './record-lock-dependents';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, type DbTransaction } from '@/db';
import { biocharProducts, deliveries, facilities, outputStockAllocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import type { CaptureActivity } from '@/lib/activity-changes';
import { SafeError } from '@/lib/errors';
import type { ActivityEventInput } from './activity-events';
import { lockMovementRequest } from './bin-movement-requests';
import { assertLockedLineagesAllowMutation, lockCertifiedLineageArtifacts, type CertifiedLineageTarget } from './certification-lineage-guards';
import { retireDocumentsForEntities } from './documents';
import { lockBinStock } from './lock-bin-stocks';
import { getOutputStockAllocationProjection, readOutputBinAllLayers } from './output-stock';
import { assertOutputMovementEditable } from './output-stock-edit-lock';
import { stockFingerprint } from './output-stock-operations';
import { appendOutputStockReversal } from './output-stock-reversal';
import { assertRowVersion, nextVersion } from './row-version';
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs } from './transport-legs';
import { requireOrgScope } from './utils';
import { resolveWriteActivityScopes } from './write-activity';

/** Topology, request, bin, artifacts, facility, delivery, then affected products. */
export async function deleteDeliveryInTransaction(ctx: OrgContext, tx: DbTransaction, deliveryId: string, expectedVersion: number, source: ActivityEventInput['source'], capture?: CaptureActivity) {
  requireOrgScope(ctx);
  await lockBiocharTransportRouteTopology(ctx, tx);
  const requestKey = randomUUID();
  await lockMovementRequest(ctx, tx, requestKey);
  const [snapshot] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId)));
  if (!snapshot) throw new SafeError('Delivery not found');
  await lockBinStock(ctx, tx, snapshot.storageLocationId, { allowArchived: true });
  const rows = await getOutputStockAllocationProjection(ctx, { deliveryId }, tx);
  const targets: CertifiedLineageTarget[] = [{ entityType: 'delivery', entityId: deliveryId }, ...[...new Set(rows.flatMap(r => r.allocation.biocharProductId ? [r.allocation.biocharProductId] : []))].map(entityId => ({ entityType: 'biocharProduct' as const, entityId }))];
  const keys = await lockCertifiedLineageArtifacts(ctx, tx, targets);
  await tx.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, snapshot.facilityId))).for('share');
  const [existing] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId))).for('update');
  if (!existing) throw new SafeError('Delivery not found');
  assertRowVersion({ entity: 'delivery', id: deliveryId, expectedVersion, actualVersion: existing.version });
  await assertLockedLineagesAllowMutation(ctx, tx, keys, targets.map(target => ({ target, mutation: 'delete' })));
  const lock = recordLocks.delivery({ removals: [], dependents: await readRecordDependents(ctx, tx, { entityType: 'delivery', entityId: deliveryId }) });
  if (lock.level !== 'open') throw new DomainError('certification_locked', withRecordLockGuidance('This delivery cannot be deleted.', lock));
  const reversed = new Set(rows.filter(r => r.movement.outputKind === 'reversal').map(r => r.movement.correctsMovementId));
  const original = rows.find(r => r.movement.outputKind !== 'reversal' && !reversed.has(r.movement.id))?.movement;
  if (!original) throw new SafeError('Posted delivery stock entry not found.');
  await assertOutputMovementEditable(ctx, existing.storageLocationId, original.id, tx);
  const activityScopes = await resolveWriteActivityScopes(ctx, tx, 'delivery', deliveryId);
  const allocations = [...new Map(rows.filter(r => r.movement.id === original.id).map(r => [r.allocation.id, r.allocation])).values()];
  const productIds = [...new Set(allocations.flatMap(a => a.biocharProductId ? [a.biocharProductId] : []))].sort();
  for (const id of productIds) await tx.select({ id: biocharProducts.id }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, id))).for('update');
  const stock = await readOutputBinAllLayers(ctx, existing.storageLocationId, tx, { includeArchived: true });
  await appendOutputStockReversal(ctx, tx, { original, allocations, rows, reason: `Deleted delivery ${existing.code}`, occurredAt: existing.deliveryDate,
    idempotencyKey: requestKey, basisFingerprint: stockFingerprint(stock.layers), payloadHash: stockFingerprint({ deliveryId, expectedVersion }), balanceBeforeDryKg: stock.allLayersDryKg });
  // The immutable movement snapshot keeps the owner identity after its nullable live link is retired.
  await tx.update(outputStockAllocations).set({ deliveryId: null }).where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.deliveryId, deliveryId)));
  await retireDocumentsForEntities(ctx, tx, [{ entityType: 'delivery', entityId: deliveryId, activityScopes }], source);
  await tx.delete(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId)));
  if (productIds.length) await tx.update(biocharProducts).set({ version: nextVersion(biocharProducts.version), updatedAt: new Date() }).where(and(eq(biocharProducts.organizationId, ctx.organizationId), inArray(biocharProducts.id, productIds)));
  await syncBiocharProductTransportLegs(ctx, tx, productIds);
  capture?.(deliveryId, { ...existing, allocations }, null);
  return { delivery: existing, activityScopes };
}

export async function deleteDelivery(ctx: OrgContext, deliveryId: string, expectedVersion: number): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(tx => deleteDeliveryInTransaction(ctx, tx, deliveryId, expectedVersion, 'form'));
}
