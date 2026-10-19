import type { FeedstockLedgerEntry } from '@/types/feedstock-bin-ledger';
import { formatFacilityDateTime } from './format-utils';
import { recordLocks, withRecordLockGuidance } from './record-lock';

function isFeedstockWithdrawal(entry: FeedstockLedgerEntry): boolean {
  return entry.kind === 'run_draw' ||
    (entry.kind === 'ingredient_draw' && !entry.reversed) ||
    (entry.kind === 'loss' && !entry.reversed) ||
    (entry.kind === 'count' && (entry.wetDeltaKg ?? 0) < 0);
}

function feedstockWithdrawalLabel(blocker: FeedstockLedgerEntry): string {
  return blocker.kind === 'run_draw' ? 'production run'
    : blocker.kind === 'ingredient_draw' ? 'product ingredient'
    : blocker.kind === 'count' ? 'stock count' : 'lost mass';
}

/** Entries are in ledger order: occurredAt, recordedAt, then id. */
export function findFeedstockLossBlocker(
  entries: readonly FeedstockLedgerEntry[],
  entryId: string,
): FeedstockLedgerEntry | null {
  const index = entries.findIndex(entry => entry.id === entryId);
  if (index < 0) return null;
  const target = entries[index];
  if (target.reversed) return target;
  return entries.slice(index + 1).find(isFeedstockWithdrawal) ?? null;
}

/** Entries are in ledger order; a replacement follows existing entries at the same time. */
export function findFeedstockLossCrossing(
  entries: readonly FeedstockLedgerEntry[],
  entryId: string,
  newOccurredAtIso: string,
): FeedstockLedgerEntry | null {
  const index = entries.findIndex(entry => entry.id === entryId);
  if (index < 0) return null;
  return entries.slice(0, index).find(entry =>
    entry.occurredAt > newOccurredAtIso && isFeedstockWithdrawal(entry),
  ) ?? null;
}

/** Shared by the ledger's edit affordance and the locked server command. */
export function formatFeedstockLossLockReason(blocker: FeedstockLedgerEntry, timeZone: string): string {
  if (blocker.reversed) return 'This entry has already been corrected. Open its correction instead.';
  const label = feedstockWithdrawalLabel(blocker);
  const holder = {
    kind: blocker.kind === 'run_draw' ? 'productionRun'
      : blocker.kind === 'ingredient_draw' ? 'biocharProduct' : 'stockEntry',
    id: blocker.sourceId ?? blocker.id,
    label: blocker.code ?? undefined,
  };
  return withRecordLockGuidance(
    `Correction blocked by a later ${label}: ${blocker.code ?? blocker.reason} (${formatFacilityDateTime(blocker.occurredAt, timeZone)}).`,
    recordLocks.stockEntry({ removals: [], dependents: [holder] }),
  );
}

export function formatFeedstockLossCrossingMessage(blocker: FeedstockLedgerEntry, timeZone: string): string {
  const label = feedstockWithdrawalLabel(blocker);
  return `Lost mass was not changed. The new time is before the ${label} ${blocker.code ?? blocker.reason}` +
    ` (${formatFacilityDateTime(blocker.occurredAt, timeZone)}).` +
    ' Choose a time after it, or delete this entry and record a new loss.';
}
