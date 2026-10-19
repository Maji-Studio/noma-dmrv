import { liveOutputMovementPredicate } from './output-stock-active-movements';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { db, type DbTransaction } from '@/db';
import { biocharProducts, binMovements, productIngredientSnapshots } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import type { CaptureActivity } from '@/lib/activity-changes';
import { DomainError } from '@/lib/domain-errors';
import { SafeError } from '@/lib/errors';
import { recordLocks, withRecordLockGuidance } from '@/lib/record-lock';
import type { ActivityEventInput } from './activity-events';
import { lockMovementRequest } from './bin-movement-requests';
import { assertLockedLineagesAllowMutation, lockCertifiedLineageArtifacts, type CertifiedLineageTarget } from './certification-lineage-guards';
import { retireDocumentsForEntities } from './documents';
import { lockActiveFacilityReference } from './facility-reference-guards';
import { lockBinStock } from './lock-bin-stocks';
import { getOutputStockAllocationProjection, readOutputBinAllLayers } from './output-stock';
import { assertOutputMovementEditable } from './output-stock-edit-lock';
import { stockFingerprint } from './output-stock-operations';
import { appendOutputStockReversal } from './output-stock-reversal';
import { readRecordDependents } from './record-lock-dependents';
import { assertRowVersion, nextVersion, staleRowVersion } from './row-version';
import { deleteTransportLegsForEntity, lockBiocharTransportRouteTopology } from './transport-legs';
import { requireOrgScope } from './utils';
import { resolveWriteActivityScopes } from './write-activity';

/** Reverse an unused product's frozen source draw, then release its ingredient and placement stock. */
export async function deleteBiocharProductInTransaction(ctx: OrgContext, tx: DbTransaction, productId: string, expectedVersion: number, source: ActivityEventInput['source'], capture?: CaptureActivity) {
  requireOrgScope(ctx);
  await lockBiocharTransportRouteTopology(ctx, tx);
  const requestKey = randomUUID();
  await lockMovementRequest(ctx, tx, requestKey);
  const [snapshot] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId)));
  if (!snapshot) throw staleRowVersion('biocharProduct', productId);
  const ingredients = await tx.select().from(productIngredientSnapshots).where(and(eq(productIngredientSnapshots.organizationId, ctx.organizationId), eq(productIngredientSnapshots.biocharProductId, productId)));
  const binIds = [...new Set([snapshot.storageLocationId, snapshot.sourceBiocharStorageLocationId, ...ingredients.map(row => row.sourceStorageLocationId)].filter((id): id is string => id !== null))].sort();
  for (const id of binIds) await lockBinStock(ctx, tx, id);
  if (!snapshot.sourceBiocharStorageLocationId) throw new SafeError('Posted product source bin not found.');
  const rows = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: snapshot.sourceBiocharStorageLocationId }, tx);
  const isLive = liveOutputMovementPredicate(rows.map(row => row.movement));
  const original = rows.find(row => row.allocation.targetBiocharProductId === productId && isLive(row.movement))?.movement;
  if (!original && rows.some(row => row.allocation.targetBiocharProductId === productId)) throw staleRowVersion('biocharProduct', productId);
  const allocations = [...new Map(rows.filter(row => row.movement.id === original?.id).map(row => [row.allocation.id, row.allocation])).values()];
  const targets: CertifiedLineageTarget[] = [{ entityType: 'biocharProduct', entityId: productId }, ...[...new Set(allocations.flatMap(row => row.productionRunId ? [row.productionRunId] : []))].map(entityId => ({ entityType: 'productionRun' as const, entityId }))];
  const keys = await lockCertifiedLineageArtifacts(ctx, tx, targets);
  await lockActiveFacilityReference(ctx, tx, snapshot.facilityId);
  const [product] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId))).for('update');
  if (!product) throw staleRowVersion('biocharProduct', productId);
  assertRowVersion({ entity: 'biocharProduct', id: productId, expectedVersion, actualVersion: product.version });
  await assertLockedLineagesAllowMutation(ctx, tx, keys, targets.map(target => ({ target, mutation: 'delete' })));
  const lock = recordLocks.biocharProduct({ removals: [], dependents: await readRecordDependents(ctx, tx, { entityType: 'biocharProduct', entityId: productId }) });
  if (lock.level !== 'open') throw new DomainError('certification_locked', withRecordLockGuidance('This product cannot be deleted.', lock));
  for (const ingredient of ingredients) {
    if (!ingredient.sourceStorageLocationId) continue;
    const [count] = await tx.select().from(binMovements).where(and(
      eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, ingredient.sourceStorageLocationId),
      eq(binMovements.lane, 'feedstock'), isNotNull(binMovements.countedMassKg), gte(binMovements.createdAt, product.createdAt),
    )).limit(1);
    if (count) throw new DomainError('certification_locked', withRecordLockGuidance('This product cannot be deleted after an ingredient stock count.', recordLocks.biocharProduct({ removals: [], dependents: [{ kind: 'stockEntry', id: count.id, label: count.reason }] })));
  }
  if (!original) throw new SafeError('Posted product stock entry not found.');
  await assertOutputMovementEditable(ctx, snapshot.sourceBiocharStorageLocationId, original.id, tx);
  const activityScopes = await resolveWriteActivityScopes(ctx, tx, 'biochar_product', productId);
  const stock = await readOutputBinAllLayers(ctx, snapshot.sourceBiocharStorageLocationId, tx, { includeArchived: true });
  await appendOutputStockReversal(ctx, tx, { original, allocations, rows, reason: `Deleted product ${product.code}`, occurredAt: product.placedAt,
    idempotencyKey: requestKey, basisFingerprint: stockFingerprint(stock.layers), payloadHash: stockFingerprint({ productId, expectedVersion }), balanceBeforeDryKg: stock.allLayersDryKg });
  const documents = await deleteTransportLegsForEntity(ctx, tx, 'biochar', productId, source);
  await retireDocumentsForEntities(ctx, tx, [...documents, { entityType: 'biochar_product', entityId: productId, activityScopes }], source);
  await tx.update(biocharProducts).set({ archivedAt: new Date(), updatedAt: new Date(), version: nextVersion(biocharProducts.version) }).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId)));
  capture?.(productId, { ...product, ingredients, allocations }, null);
  return { product, activityScopes };
}

export async function deleteBiocharProduct(ctx: OrgContext, productId: string, expectedVersion: number): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(tx => deleteBiocharProductInTransaction(ctx, tx, productId, expectedVersion, 'form'));
}
