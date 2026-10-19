import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, productionRuns, storageLocations, outputStockMoistureReadings } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import type { RecordLock } from '@/lib/record-lock';
import { formatCertificationHolderDetail } from '@/lib/certification/lineage-lock-message';
import { SafeError } from '@/lib/errors';
import { DomainError } from '@/lib/domain-errors';
import { conflictCode } from '@/lib/conflict-ref';
import { stockReceiptMarker } from '@/lib/output-stock/edit-lock';
import { and, eq, inArray } from 'drizzle-orm';
import { getRecordLocks, type CertifiedLineageTarget } from './certification-lineage-guards';
import type { OutputStockLayer } from '@/lib/output-stock';
import { requireOrgScope } from './utils';
import { assertOutputCorrectionDependencies } from './output-stock-corrections';
import { getOutputStockAllocationProjection, readOutputBinAllLayers, UnresolvedOutputStockError } from './output-stock';

type Reader = Pick<DbTransaction, 'select' | 'selectDistinct'>;

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
  certificationLocks?: readonly RecordLock[];
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
    let locks = facts.certificationLocks;
    if (!locks) {
      const movementLocks = await getOutputMovementCertificationLocks(ctx, reader, [movementId], all);
      locks = movementLocks.get(movementId) ?? [];
    }
    const sent = locks.find(lock => lock.level === 'sent');
    if (sent) return `This stock entry is locked by a certification submission.${formatCertificationHolderDetail(sent)} ${sent.howToFree}`;
    await assertOutputCorrectionDependencies(ctx, { storageLocationId, facilityId }, original, allocations, all, layers, reader);
    return null;
  } catch (error) {
    if (error instanceof UnresolvedOutputStockError) return UNVERIFIABLE_OUTPUT_ENTRY;
    if (error instanceof DomainError && error.code === 'certification_locked') return error.message;
    throw error;
  }
}

/** Checks dependencies and Sent. Caller holds the bin lock. */
export async function assertOutputMovementEditable(ctx: OrgContext, storageLocationId: string, movementId: string, tx: DbTransaction): Promise<void> {
  requireOrgScope(ctx);
  const reason = await outputMovementLockReason(ctx, storageLocationId, movementId, tx);
  if (!reason) return;
  const [bin] = await tx.select({ code: storageLocations.code }).from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found.');
  throw new DomainError("certification_locked", reason, { conflict: { entity: 'storageLocation', id: storageLocationId, code: conflictCode(bin.code) } });
}

/** One lineage read and shared registry evidence for all history entries. */
export async function getOutputMovementCertificationLocks(ctx: OrgContext, reader: Reader, movementIds: readonly string[], all: OutputMovementLockFacts['all']) {
  requireOrgScope(ctx);
  const readings = movementIds.length ? await reader.select().from(outputStockMoistureReadings).where(and(
    eq(outputStockMoistureReadings.organizationId, ctx.organizationId), inArray(outputStockMoistureReadings.movementId, [...movementIds]),
  )) : [];
  const targetsByMovement = new Map(movementIds.map(id => {
    const sources = [...all.filter(row => row.movement.id === id).map(row => row.allocation), ...readings.filter(row => row.movementId === id)];
    const targets: CertifiedLineageTarget[] = sources.flatMap(source => [
      ...(source.biocharProductId ? [{ entityType: 'biocharProduct' as const, entityId: source.biocharProductId }] : []),
      ...(source.productionRunId ? [{ entityType: 'productionRun' as const, entityId: source.productionRunId }] : []),
      ...('deliveryId' in source && source.deliveryId ? [{ entityType: 'delivery' as const, entityId: source.deliveryId }] : []),
    ]);
    return [id, targets] as const;
  }));
  const key = (target: CertifiedLineageTarget) => `${target.entityType}:${target.entityId}`;
  const targets = [...new Map([...targetsByMovement.values()].flat().map(target => [key(target), target])).values()];
  const locks = await getRecordLocks(ctx, reader, targets, { sentOnly: true });
  const byTarget = new Map(targets.map((target, index) => [key(target), locks[index]]));
  return new Map([...targetsByMovement].map(([id, targets]) => [id, targets.map(target => byTarget.get(key(target))!)]));
}
