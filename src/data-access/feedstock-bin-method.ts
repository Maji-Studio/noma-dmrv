import type { DbTransaction } from '@/db';
import { feedstockBinMethodChanges, type StorageLocation } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import type { FeedstockDrawMethod } from '@/lib/feedstock-draw-replay';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { FEEDSTOCK_MERGE_TIME_REQUIRED_MESSAGE } from '@/schemas/storage-locations';
import { getFeedstockBinStock } from './feedstock-bin-ledger';
import { getFeedstockMethodChanges } from './feedstock-bin-method-history';
import { getOutputStockFacilityTimezone } from './output-stock-dates';
import { requireOrgScope } from './utils';

/** Caller holds the bin lock. The following bin update and replan share this transaction. */
export async function applyFeedstockMethodChange(ctx: OrgContext, tx: DbTransaction, existing: StorageLocation,
  next: Partial<FeedstockDrawMethod> & { mergedAt?: Date }): Promise<FeedstockDrawMethod & { effectiveAt?: Date }> {
  requireOrgScope(ctx);
  const target = { stockMode: next.stockMode ?? existing.stockMode, drawOrder: next.drawOrder ?? existing.drawOrder };
  if (target.stockMode === existing.stockMode && target.drawOrder === existing.drawOrder) return target;
  const stock = await getFeedstockBinStock(ctx, existing.id, tx);
  const history = await getFeedstockMethodChanges(ctx, existing.id, tx);
  if (!stock.entries.length && !history.length) return target;
  const last = [...stock.entries.filter(entry => !entry.reversed).map(entry => entry.occurredAt), ...history.map(change => change.effectiveAt)].sort().at(-1);
  const now = new Date();
  let effectiveAt = now;
  const facilityTime = async (at: string) => formatFacilityDateTime(new Date(at), await getOutputStockFacilityTimezone(ctx, existing.facilityId, tx));
  if (target.stockMode === 'mix' && existing.stockMode === 'split') {
    if (!next.mergedAt || !Number.isFinite(next.mergedAt.getTime())) throw new SafeError(FEEDSTOCK_MERGE_TIME_REQUIRED_MESSAGE);
    effectiveAt = next.mergedAt;
    if (effectiveAt > now) throw new SafeError('Merged at cannot be in the future.');
    if (last && effectiveAt.toISOString() <= last)
      throw new SafeError(`Set Merged at later than the bin's last recorded movement (${await facilityTime(last)}). Movements already recorded keep their draw method.`);
  } else {
    if (last && last > now.toISOString())
      throw new SafeError(`This bin has a movement recorded for ${await facilityTime(last)}. Change its draw method after that time.`);
    if (existing.stockMode === 'mix' && target.stockMode === 'split' && stock.currentWetKg > 0)
      throw new SafeError('Empty this bin before switching it to In order. If nothing is left, record a stock count of zero first. A mixed pile cannot be sorted back into deliveries.');
  }
  await tx.insert(feedstockBinMethodChanges).values({ organizationId: ctx.organizationId, storageLocationId: existing.id,
    ...target, previousStockMode: existing.stockMode, previousDrawOrder: existing.drawOrder, effectiveAt, createdBy: ctx.userId });
  return { ...target, effectiveAt };
}
