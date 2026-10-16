import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, productionRuns, storageLocations, outputStockMoistureReadings } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { DomainError } from '@/lib/domain-errors';
import { conflictCode } from '@/lib/conflict-ref';
import { stockReceiptMarker } from '@/lib/output-stock/edit-lock';
import { and, eq } from 'drizzle-orm';
import { getRecordLocks, type CertifiedLineageTarget } from './certification-lineage-guards';
import type { OutputStockLayer } from '@/lib/output-stock';
import { requireOrgScope } from './utils';
import { assertOutputCorrectionDependencies } from './output-stock-corrections';
import { getOutputStockAllocationProjection, readOutputBinAllLayers, UnresolvedOutputStockError } from './output-stock';

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

export const UNVERIFIABLE_OUTPUT_ENTRY = 'Stock entry is locked because its source stock cannot be verified. Complete the source records, then refresh.';

export interface OutputMovementLockFacts {
  original: typeof binMovements.$inferSelect;
  facilityId: string;
  all: Awaited<ReturnType<typeof getOutputStockAllocationProjection>>;
  layers: OutputStockLayer[] | null;
}

/** Browser advisory checks both certification lineage and numeric dependencies. */
export async function outputMovementLockReason(ctx: OrgContext, storageLocationId: string, movementId: string, reader: Reader = db, facts?: OutputMovementLockFacts): Promise<string | null> {
  requireOrgScope(ctx);
  try {
    if (!facts) {
      const [original] = await reader.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.id, movementId)));
      if (!original) throw new SafeError('Stock entry not found.');
      const [bin] = await reader.select({ facilityId: storageLocations.facilityId }).from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
      if (!bin) throw new SafeError('Storage bin not found.');
      const all = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: storageLocationId }, reader);
      const { layers } = await readOutputBinAllLayers(ctx, storageLocationId, reader, { includeArchived: true });
      facts = { original, facilityId: bin.facilityId, all, layers };
    }
    if (!facts.layers) return UNVERIFIABLE_OUTPUT_ENTRY;
    const { original, facilityId, all, layers } = facts;
    const allocations = [...new Map(all.filter(row => row.movement.id === movementId).map(row => [row.allocation.id, row.allocation])).values()];
    const targets: CertifiedLineageTarget[] = allocations.flatMap(allocation => [
      ...(allocation.biocharProductId ? [{ entityType: 'biocharProduct' as const, entityId: allocation.biocharProductId }] : []),
      ...(allocation.productionRunId ? [{ entityType: 'productionRun' as const, entityId: allocation.productionRunId }] : []),
      ...(allocation.deliveryId ? [{ entityType: 'delivery' as const, entityId: allocation.deliveryId }] : []),
    ]);
    const readings = await reader.select().from(outputStockMoistureReadings).where(and(
      eq(outputStockMoistureReadings.organizationId, ctx.organizationId), eq(outputStockMoistureReadings.movementId, movementId),
    ));
    for (const reading of readings) {
      if (reading.biocharProductId) targets.push({ entityType: 'biocharProduct', entityId: reading.biocharProductId });
      if (reading.productionRunId) targets.push({ entityType: 'productionRun', entityId: reading.productionRunId });
    }
    const locks = await getRecordLocks(ctx, reader, targets);
    const sent = locks.find(lock => lock.level === 'sent');
    if (sent) return `This stock entry is locked by a certification submission. ${sent.howToFree}`;
    await assertOutputCorrectionDependencies(ctx, { storageLocationId, facilityId }, original, allocations, all, layers, reader);
    return null;
  } catch (error) {
    if (error instanceof UnresolvedOutputStockError) return UNVERIFIABLE_OUTPUT_ENTRY;
    if (error instanceof DomainError && error.code === 'certification_locked') return error.message;
    throw error;
  }
}

/** Legacy name: checks dependencies and Sent, not whether the entry is latest. Caller holds the bin lock. */
export async function assertLatestOutputMovement(ctx: OrgContext, storageLocationId: string, movementId: string, tx: DbTransaction): Promise<void> {
  requireOrgScope(ctx);
  const reason = await outputMovementLockReason(ctx, storageLocationId, movementId, tx);
  if (!reason) return;
  const [bin] = await tx.select({ code: storageLocations.code }).from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found.');
  throw new DomainError("certification_locked", reason, { conflict: { entity: 'storageLocation', id: storageLocationId, code: conflictCode(bin.code) } });
}
