import { randomUUID } from 'node:crypto';
import { db, type DbTransaction } from '@/db';
import { binMovements, type StorageLocation } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { grams, kilograms } from '@/lib/output-stock';
import { stockModeAt, type OutputStockMode } from '@/lib/output-stock/stock-mode';
import { isOutputBinType, type StorageLocationType } from '@/schemas/storage-locations';
import { and, desc, eq } from 'drizzle-orm';
import { requestFingerprint } from './bin-movement-requests';
import { getBiocharOutputStockLayers, getProductOutputStockLayers } from './output-stock';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;

const MERGE_REASON = 'Merged into one pile';

/** When the bin's latest merge happened, or null when it was never merged. */
export async function getLatestMergeAt(ctx: OrgContext, storageLocationId: string, reader: Reader = db): Promise<string | null> {
  requireOrgScope(ctx);
  const [merge] = await reader.select({ occurredAt: binMovements.occurredAt }).from(binMovements)
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.outputKind, 'merge')))
    .orderBy(desc(binMovements.postingSequence)).limit(1);
  return merge?.occurredAt?.toISOString() ?? null;
}

/** The bin's stock mode at `at`: a draw timed before a merge is planned as split. */
export async function getStockModeAt(ctx: OrgContext, bin: Pick<StorageLocation, 'id' | 'stockMode'>, at: string, reader: Reader = db): Promise<OutputStockMode> {
  requireOrgScope(ctx);
  return stockModeAt(bin.stockMode, bin.stockMode === 'mix' ? await getLatestMergeAt(ctx, bin.id, reader) : null, at);
}

/**
 * Applies a stock-mode change from the bin form, under the bin's stock lock and
 * row lock the edit already holds. Split to mix posts a timed merge event:
 * every batch present is drawn pro-rata after it, and nothing already posted
 * changes. Mix to split needs an empty bin, since a mixed pile can't be sorted
 * back into batches. Returns the mode to save.
 */
export async function applyStockModeChange(ctx: OrgContext, tx: DbTransaction, existing: StorageLocation,
  next: { type: StorageLocationType; stockMode?: OutputStockMode; mergedAt?: Date }): Promise<OutputStockMode> {
  requireOrgScope(ctx);
  if (!isOutputBinType(next.type)) return 'split';
  const target = next.stockMode ?? existing.stockMode;
  if (target === existing.stockMode) return target;
  // A bin changes type only while it holds nothing (the identity guard sees to
  // that), so there is no pile to merge or sort.
  if (next.type !== existing.type) return target;
  const layers = await readAllLayers(ctx, tx, existing);
  if (target === 'split') {
    if (layers.some(layer => grams(layer.remainingDryBiocharKg) > BigInt(0) || (layer.remainingSolidsKg?.numerator ?? BigInt(0)) > BigInt(0))) {
      throw new SafeError('Empty this bin before switching it to split. A mixed pile cannot be sorted back into batches.');
    }
    return 'split';
  }
  const mergedAt = next.mergedAt ?? new Date();
  if (mergedAt.getTime() > Date.now()) throw new SafeError('The merge time cannot be in the future.');
  const balance = kilograms(layers.reduce((sum, layer) => sum + grams(layer.remainingDryBiocharKg), BigInt(0)));
  const occurredAt = mergedAt.toISOString();
  await tx.insert(binMovements).values({ organizationId: ctx.organizationId, storageLocationId: existing.id, lane: existing.type === 'biochar_bin' ? 'biochar' : 'product',
    movementType: 'adjustment', massDeltaKg: 0, reason: MERGE_REASON, createdBy: ctx.userId, outputKind: 'merge', occurredAt: mergedAt,
    idempotencyKey: `merge:${randomUUID()}`, basisFingerprint: requestFingerprint({ binId: existing.id, occurredAt, balance }),
    inputSnapshot: { kind: 'merge', from: 'split', to: 'mix', actorId: ctx.userId }, outputDryDeltaKg: '0.000', balanceBeforeDryKg: balance, balanceAfterDryKg: balance });
  return 'mix';
}

/** Every layer the bin has held, including ones placed later than now. */
async function readAllLayers(ctx: OrgContext, tx: DbTransaction, bin: StorageLocation) {
  const input = { storageLocationId: bin.id, facilityId: bin.facilityId, occurredAt: new Date().toISOString() };
  const state = bin.type === 'biochar_bin' ? await getBiocharOutputStockLayers(ctx, input, tx) : await getProductOutputStockLayers(ctx, input, tx);
  return state.layers;
}

/** The mode a new bin starts in: output bins choose, every other bin is split. */
export function initialStockMode(type: StorageLocationType, stockMode: OutputStockMode | undefined): OutputStockMode {
  return isOutputBinType(type) ? stockMode ?? 'split' : 'split';
}
