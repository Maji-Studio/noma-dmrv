import { randomUUID } from 'node:crypto';
import { db, type DbTransaction } from '@/db';
import { binMovements, type StorageLocation } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { grams, kilograms } from '@/lib/output-stock';
import { outputStockEventLabel } from '@/lib/output-stock/labels';
import { stockModeAt, type OutputStockMode, type StockModeChange } from '@/lib/output-stock/stock-mode';
import { isOutputBinType, type StorageLocationType } from '@/schemas/storage-locations';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { requestFingerprint } from './bin-movement-requests';
import { getBiocharOutputStockLayers, getProductOutputStockLayers } from './output-stock';
import { getOutputStockFacilityTimezone } from './output-stock-dates';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;

/** Movements that switch a bin's mode: a merge into one pile, or a switch back to split once empty. */
const MODE_CHANGE_KINDS = ['merge', 'split'] as const;

/** Every timed mode change the bin has had, in posting order. */
export async function getStockModeChanges(ctx: OrgContext, storageLocationId: string, reader: Reader = db): Promise<StockModeChange[]> {
  requireOrgScope(ctx);
  const rows = await reader.select({ kind: binMovements.outputKind, occurredAt: binMovements.occurredAt, sequence: binMovements.postingSequence }).from(binMovements)
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, storageLocationId), inArray(binMovements.outputKind, [...MODE_CHANGE_KINDS])))
    .orderBy(binMovements.postingSequence);
  return rows.map(row => ({ to: row.kind === 'merge' ? 'mix' : 'split', at: row.occurredAt!.toISOString(), sequence: row.sequence }));
}

/** The bin's stock mode at `at`: an entry is planned in the mode in force at its own time. */
export async function getStockModeAt(ctx: OrgContext, bin: Pick<StorageLocation, 'id' | 'stockMode'>, at: string, reader: Reader = db): Promise<OutputStockMode> {
  requireOrgScope(ctx);
  return stockModeAt(bin.stockMode, await getStockModeChanges(ctx, bin.id, reader), at);
}

/**
 * Applies a stock-mode change from the bin form, under the bin's stock lock and
 * row lock the edit already holds. Both directions post a timed movement, so an
 * entry keeps the mode in force at its own time when it is corrected later.
 * Split to mix is a merge at the operator's time: every batch present is drawn
 * pro-rata after it. It must come after the bin's last recorded movement,
 * which was posted as split. Mix to split needs an empty bin, because a mixed pile
 * can't be sorted back into batches, and takes effect now. Returns the mode
 * to save.
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
  const balance = kilograms(layers.reduce((sum, layer) => sum + grams(layer.remainingDryBiocharKg), BigInt(0)));
  const [last] = await tx.select({ occurredAt: binMovements.occurredAt }).from(binMovements)
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, existing.id), isNotNull(binMovements.outputKind)))
    .orderBy(desc(binMovements.occurredAt)).limit(1);
  // A bin that never held stock has no history to keep in its mode; a movement would only block deleting it.
  if (!layers.length && !last) return target;
  const facilityTime = async (at: Date) => formatFacilityDateTime(at, await getOutputStockFacilityTimezone(ctx, existing.facilityId, tx));
  if (target === 'split') {
    // Emptiness is judged now; a removal timed later would still draw from the pile.
    if (last?.occurredAt && last.occurredAt.getTime() > Date.now()) {
      throw new SafeError(`This bin has a movement recorded for ${await facilityTime(last.occurredAt)}. Switch it to split after that time.`);
    }
    if (layers.some(layer => grams(layer.remainingDryBiocharKg) > BigInt(0) || (layer.remainingSolidsKg?.numerator ?? BigInt(0)) > BigInt(0))) {
      throw new SafeError('Empty this bin before switching it to split. If nothing is left, record a stock count of zero first. A mixed pile cannot be sorted back into batches.');
    }
    await postModeChange(ctx, tx, existing, 'split', new Date(), balance);
    return 'split';
  }
  const mergedAt = next.mergedAt ?? new Date();
  if (mergedAt.getTime() > Date.now()) throw new SafeError('Merged at cannot be in the future.');
  // Strictly after: a merge at the same instant would pull that split entry into the mix period.
  if (last?.occurredAt && mergedAt.getTime() <= last.occurredAt.getTime()) {
    const at = await facilityTime(last.occurredAt);
    throw new SafeError(`Set Merged at later than the bin's last recorded movement (${at}). Movements already recorded stay split.`);
  }
  await postModeChange(ctx, tx, existing, 'merge', mergedAt, balance);
  return 'mix';
}

/** A mode change moves no stock; it records when later removals change how they draw. */
async function postModeChange(ctx: OrgContext, tx: DbTransaction, bin: StorageLocation, kind: (typeof MODE_CHANGE_KINDS)[number], at: Date, balance: string) {
  const occurredAt = at.toISOString();
  await tx.insert(binMovements).values({ organizationId: ctx.organizationId, storageLocationId: bin.id, lane: bin.type === 'biochar_bin' ? 'biochar' : 'product',
    movementType: 'adjustment', massDeltaKg: 0, reason: outputStockEventLabel(kind), createdBy: ctx.userId, outputKind: kind, occurredAt: at,
    idempotencyKey: `${kind}:${randomUUID()}`, basisFingerprint: requestFingerprint({ binId: bin.id, kind, occurredAt, balance }),
    inputSnapshot: { kind, to: kind === 'merge' ? 'mix' : 'split', actorId: ctx.userId }, outputDryDeltaKg: '0.000', balanceBeforeDryKg: balance, balanceAfterDryKg: balance });
}

/**
 * An addition (a product placed, a run completed) timed before a later switch
 * to split would put stock from the mix period into a bin now kept as
 * separate sub-bins, where later draws would treat it as unmixed. Requires the
 * bin's stock lock.
 */
export async function assertAdditionAfterSplit(ctx: OrgContext, tx: DbTransaction, bin: { id: string; facilityId: string }, at: Date): Promise<void> {
  requireOrgScope(ctx);
  const split = (await getStockModeChanges(ctx, bin.id, tx)).filter(change => change.to === 'split' && change.at > at.toISOString()).at(-1);
  if (!split) return;
  const when = formatFacilityDateTime(new Date(split.at), await getOutputStockFacilityTimezone(ctx, bin.facilityId, tx));
  throw new SafeError(`This bin was switched to split at ${when}, after this time. Record the addition at or after ${when}.`);
}

type RunPlacement = { status: string; biocharStorageLocationId: string | null; facilityId: string; endTime: Date | null };

/**
 * A production run adds its biochar to its bin when it completes, or again
 * when a completed run moves bin or changes its end time; that addition can't
 * be timed before a later switch to split. Requires the bin's stock lock.
 */
export async function assertRunAdditionAfterSplit(ctx: OrgContext, tx: DbTransaction, next: RunPlacement, previous?: Omit<RunPlacement, 'facilityId'>): Promise<void> {
  requireOrgScope(ctx);
  if (next.status !== 'complete' || !next.biocharStorageLocationId || !next.endTime) return;
  const unchanged = previous?.status === 'complete' && previous.biocharStorageLocationId === next.biocharStorageLocationId && previous.endTime?.getTime() === next.endTime.getTime();
  if (!unchanged) await assertAdditionAfterSplit(ctx, tx, { id: next.biocharStorageLocationId, facilityId: next.facilityId }, next.endTime);
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
