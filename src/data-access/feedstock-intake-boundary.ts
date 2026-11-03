import type { FeedstockMethodChange, FeedstockReplayEvent } from '@/lib/feedstock-draw-replay';
import { compareFeedstockEvents } from '@/lib/feedstock-draw-replay';
import { SafeError } from '@/lib/errors';
import { formatFacilityDateTime } from '@/lib/format-utils';

/** Every transactional replan must preserve the empty mixed pile at each In order switch. */
export function assertFeedstockEmptyAtSwitch(events: readonly FeedstockReplayEvent[],
  wetTotals: ReadonlyMap<string, number>, changes: readonly FeedstockMethodChange[], timezone: string): void {
  const ordered = [...events].sort(compareFeedstockEvents);
  for (const change of changes) {
    if (change.previousStockMode !== 'mix' || change.stockMode !== 'split') continue;
    const last = ordered.filter(event => event.occurredAt <= change.effectiveAt).at(-1);
    if (!last || wetTotals.get(last.id) === 0) continue;
    const when = formatFacilityDateTime(new Date(change.effectiveAt), timezone);
    throw new SafeError(`This bin was switched to In order at ${when}. This change would leave stock in the bin at that time. Empty the bin before switching to In order.`);
  }
}
