import { and, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { biocharProducts, binMovements, outputStockAllocations, type BiocharProductRecord } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import type { CaptureActivity } from '@/lib/activity-changes';
import { SafeError } from '@/lib/errors';
import { ALREADY_CORRECTED_MESSAGE, ALREADY_DELETED_MESSAGE } from '@/lib/loss-correction-messages';
import type { RemoveLossData } from '@/schemas/bin-movements';
import { requestFingerprint } from './bin-movement-requests';
import { toBiocharProductRecord } from './biochar-product-record';
import { lockBinStocks } from './lock-bin-stocks';
import { readOutputBinAllLayers } from './output-stock';
import { prepareOutputCorrection } from './output-stock-corrections';
import { assertOutputMovementEditable } from './output-stock-edit-lock';
import { assertOutputLayersMutable, changedOutputLayerIds } from './output-stock-lineage';
import { stockFingerprint } from './output-stock-operations';
import { findPostedOutputRequest, readOutputStockBin } from './output-stock-post';
import { appendOutputStockReversal } from './output-stock-reversal';
import { nextVersion } from './row-version';
import { lockBiocharTransportRouteTopology } from './transport-legs';
import { requireOrgScope } from './utils';

export interface RemovedOutputStockLoss {
  movementId: string;
  savedProducts: BiocharProductRecord[];
  savedDeliveries: [];
}

interface RemoveOutputStockLossOptions {
  capture?: CaptureActivity;
  onReplay?: () => void;
  link?: (links: { facilityId: string; productionRunId?: string }) => void;
}

/** A form delete cancels frozen effects under the same locks as an Edit. */
export async function removeOutputStockLossInTransaction(ctx: OrgContext, tx: DbTransaction, input: RemoveLossData, options: RemoveOutputStockLossOptions = {}): Promise<RemovedOutputStockLoss> {
  requireOrgScope(ctx);
  const { storageLocationId, correctsMovementId, idempotencyKey, reason } = input;
  const payload = { storageLocationId, correctsMovementId, reason };
  await lockBiocharTransportRouteTopology(ctx, tx);
  const existing = await findPostedOutputRequest(ctx, tx, { storageLocationId, idempotencyKey, payload });
  if (existing) {
    options.onReplay?.();
    const products = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, storageLocationId)));
    return { movementId: existing.id, savedProducts: products.map(toBiocharProductRecord), savedDeliveries: [] };
  }
  const bin = await readOutputStockBin(ctx, tx, { storageLocationId });
  await lockBinStocks(ctx, tx, [storageLocationId]);
  const [original] = await tx.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.id, correctsMovementId)));
  if (!original || !(original.outputKind === 'loss' || (original.outputKind === 'replacement' && original.inputSnapshot?.kind === 'loss'))) {
    throw new SafeError('Choose a Lost mass entry in this bin to delete.');
  }
  const corrections = await tx.select({ outputKind: binMovements.outputKind }).from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.correctsMovementId, original.id)));
  if (corrections.length) {
    const deleted = corrections.some(row => row.outputKind === 'reversal') && !corrections.some(row => row.outputKind === 'replacement');
    throw new SafeError(deleted ? ALREADY_DELETED_MESSAGE : ALREADY_CORRECTED_MESSAGE);
  }
  await assertOutputMovementEditable(ctx, storageLocationId, original.id, tx);
  const stock = await readOutputBinAllLayers(ctx, storageLocationId, tx, { includeArchived: true });
  const correction = await prepareOutputCorrection(ctx, {
    storageLocationId, facilityId: bin.facilityId, correctsMovementId, kind: 'loss', occurredAt: original.occurredAt!.toISOString(),
    // Restoration reads frozen allocations, never this planning-only mass.
    wetMassKg: Number(original.inputSnapshot?.wetMassKg ?? 0),
  }, stock.layers, tx);
  const lane = original.lane === 'product' ? 'product' : 'biochar';
  const changedLayerIds = await changedOutputLayerIds(ctx, tx, { lane, layers: correction.layers, plan: null, readings: [], correction });
  await assertOutputLayersMutable(ctx, tx, lane, changedLayerIds);
  const productIds = lane === 'product' ? [...changedLayerIds].sort() : [];
  // Parent row locks precede the ledger children's foreign-key locks.
  for (const id of productIds) {
    const [product] = await tx.select({ id: biocharProducts.id }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, id))).for('update');
    if (!product) throw new SafeError('Biochar product not found');
  }
  const reversal = await appendOutputStockReversal(ctx, tx, {
    ...correction, reason, occurredAt: original.occurredAt!, idempotencyKey,
    payloadHash: requestFingerprint(payload), basisFingerprint: stockFingerprint(stock.layers), balanceBeforeDryKg: stock.allLayersDryKg,
  });
  const products = productIds.length ? await tx.update(biocharProducts).set({ version: nextVersion(biocharProducts.version), updatedAt: new Date() })
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), inArray(biocharProducts.id, productIds))).returning() : [];
  const allocations = await tx.select().from(outputStockAllocations).where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.movementId, reversal.id)));
  options.capture?.(reversal.id, null, { ...reversal, sources: reversal.inputSnapshot?.sources, allocations });
  const runIds = [...new Set(correction.rows.flatMap(row => row.run ? [row.run.productionRunId] : []))];
  options.link?.({ facilityId: bin.facilityId, productionRunId: runIds.length === 1 ? runIds[0] : undefined });
  return { movementId: reversal.id, savedProducts: products.map(toBiocharProductRecord), savedDeliveries: [] };
}
