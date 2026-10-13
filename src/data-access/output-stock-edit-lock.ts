import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, productionRuns, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { ActionConflictError, SafeError } from '@/lib/errors';
import { conflictCode } from '@/lib/conflict-ref';
import { stockEntryLockReason, stockReceiptMarker } from '@/lib/output-stock/edit-lock';
import { STOCK_ENTRY_LOCKED_REASON } from '@/lib/output-stock/labels';
import { and, eq, gt } from 'drizzle-orm';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;

/** Freeze a bounded receipt marker under the bin lock, including future and archived receipts. */
export async function outputReceiptMarker(ctx: OrgContext, storageLocationId: string, reader: Reader) {
  requireOrgScope(ctx);
  const [products, runs] = await Promise.all([
    reader.select({ id: biocharProducts.id }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, storageLocationId))),
    reader.select({ id: productionRuns.id }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, storageLocationId), eq(productionRuns.status, 'complete'))),
  ]);
  return stockReceiptMarker([...products, ...runs]);
}

/** Posting order, rather than physical event time: a backdated new entry also locks edits. */
export async function outputMovementLockReason(ctx: OrgContext, storageLocationId: string, movementId: string, reader: Reader = db): Promise<string | null> {
  requireOrgScope(ctx);
  const [original] = await reader.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.id, movementId)));
  if (!original) throw new SafeError('Stock entry not found.');
  const [later, products, runs] = await Promise.all([
    reader.select({ id: binMovements.id }).from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), gt(binMovements.postingSequence, original.postingSequence))).limit(1),
    // Receipts live on their own records, outside the bin-movement sequence.
    reader.select({ id: biocharProducts.id, recordedAt: biocharProducts.createdAt }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, storageLocationId))),
    reader.select({ id: productionRuns.id, recordedAt: productionRuns.updatedAt }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, storageLocationId), eq(productionRuns.status, 'complete'))),
  ]);
  return stockEntryLockReason(original, original.postingSequence + (later.length ? BigInt(1) : BigInt(0)), [...products, ...runs]);
}

/** Caller holds the posting path's transaction-scoped bin-stock lock. */
export async function assertLatestOutputMovement(ctx: OrgContext, storageLocationId: string, movementId: string, tx: DbTransaction): Promise<void> {
  requireOrgScope(ctx);
  if (!await outputMovementLockReason(ctx, storageLocationId, movementId, tx)) return;
  const [bin] = await tx.select({ code: storageLocations.code }).from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found.');
  throw new ActionConflictError(STOCK_ENTRY_LOCKED_REASON, { entity: 'storageLocation', id: storageLocationId, code: conflictCode(bin.code) });
}
