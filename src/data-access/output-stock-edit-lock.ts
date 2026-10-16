import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, productionRuns, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { DomainError } from '@/lib/domain-errors';
import { conflictCode } from '@/lib/conflict-ref';
import { stockReceiptMarker } from '@/lib/output-stock/edit-lock';
import { and, eq } from 'drizzle-orm';
import { requireOrgScope } from './utils';
import { assertOutputCorrectionDependencies } from './output-stock-corrections';
import { getOutputStockAllocationProjection, readOutputBinAllLayers } from './output-stock';

type Reader = Pick<DbTransaction, 'select'>;

/** Receipts live outside the movement sequence, including future and archived receipts. */
export async function outputBinReceipts(ctx: OrgContext, storageLocationId: string, reader: Reader): Promise<{ id: string; recordedAt: Date }[]> {
  requireOrgScope(ctx);
  const [products, runs] = await Promise.all([
    reader.select({ id: biocharProducts.id, recordedAt: biocharProducts.createdAt }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, storageLocationId))),
    reader.select({ id: productionRuns.id, recordedAt: productionRuns.updatedAt }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, storageLocationId), eq(productionRuns.status, 'complete'))),
  ]);
  return [...products, ...runs];
}

/** Freeze a bounded receipt marker under the bin lock, including future and archived receipts. */
export async function outputReceiptMarker(ctx: OrgContext, storageLocationId: string, reader: Reader) {
  requireOrgScope(ctx);
  return stockReceiptMarker(await outputBinReceipts(ctx, storageLocationId, reader));
}

/** Browser advisory uses the same numeric dependency check as correction posting. */
export async function outputMovementLockReason(ctx: OrgContext, storageLocationId: string, movementId: string, reader: Reader = db): Promise<string | null> {
  requireOrgScope(ctx);
  const [original] = await reader.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.id, movementId)));
  if (!original) throw new SafeError('Stock entry not found.');
  const [bin] = await reader.select({ facilityId: storageLocations.facilityId }).from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found.');
  const all = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: storageLocationId }, reader);
  const allocations = [...new Map(all.filter(row => row.movement.id === movementId).map(row => [row.allocation.id, row.allocation])).values()];
  const { layers } = await readOutputBinAllLayers(ctx, storageLocationId, reader, { includeArchived: true });
  try {
    await assertOutputCorrectionDependencies(ctx, { storageLocationId, facilityId: bin.facilityId }, original, allocations, all, layers, reader);
    return null;
  } catch (error) {
    if (error instanceof DomainError && error.code === "certification_locked") return error.message;
    throw error;
  }
}

/** Caller holds the posting path's transaction-scoped bin-stock lock. */
export async function assertLatestOutputMovement(ctx: OrgContext, storageLocationId: string, movementId: string, tx: DbTransaction): Promise<void> {
  requireOrgScope(ctx);
  const reason = await outputMovementLockReason(ctx, storageLocationId, movementId, tx);
  if (!reason) return;
  const [bin] = await tx.select({ code: storageLocations.code }).from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found.');
  throw new DomainError("certification_locked", reason, { conflict: { entity: 'storageLocation', id: storageLocationId, code: conflictCode(bin.code) } });
}
