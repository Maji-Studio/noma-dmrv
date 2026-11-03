import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { formatUtcDate, startOfFacilityDay } from '@/lib/date-utils';
import { SafeError } from '@/lib/errors';
import { formatFacilityDateTime } from '@/lib/format-utils';
import { getFeedstockMethodChanges } from './feedstock-bin-method-history';
import { getOutputStockFacilityTimezone } from './output-stock-dates';
import { requireOrgScope } from './utils';

/** Caller holds the bin lock. Delivery days become available at facility-local day start. */
export async function assertFeedstockAdditionAfterSplit(ctx: OrgContext, tx: DbTransaction,
  bin: { id: string; facilityId: string }, deliveryDate: Date): Promise<void> {
  requireOrgScope(ctx);
  const timezone = await getOutputStockFacilityTimezone(ctx, bin.facilityId, tx);
  const at = startOfFacilityDay(formatUtcDate(deliveryDate), timezone).toISOString();
  const split = (await getFeedstockMethodChanges(ctx, bin.id, tx)).filter(change =>
    change.previousStockMode === 'mix' && change.stockMode === 'split' && change.effectiveAt > at).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt)).at(-1);
  if (!split) return;
  const when = formatFacilityDateTime(new Date(split.effectiveAt), timezone);
  throw new SafeError(`This bin was switched to In order at ${when}, after this delivery day started. Choose a delivery day starting at or after ${when}.`);
}
