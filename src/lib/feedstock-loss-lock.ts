import type { FeedstockLedgerEntry } from '@/types/feedstock-bin-ledger';
import { formatFacilityDateTime } from './format-utils';
import { recordLocks, withRecordLockGuidance } from './record-lock';

/** Entries are in ledger order: occurredAt, recordedAt, then id. */
export function findFeedstockLossBlocker(
  entries: readonly FeedstockLedgerEntry[],
  entryId: string,
): FeedstockLedgerEntry | null {
  const index = entries.findIndex(entry => entry.id === entryId);
  if (index < 0) return null;
  const target = entries[index];
  if (target.reversed) return target;
  return entries.slice(index + 1).find(entry =>
    entry.kind === 'run_draw' ||
    (entry.kind === 'ingredient_draw' && !entry.reversed) ||
    (entry.kind === 'loss' && !entry.reversed) ||
    (entry.kind === 'count' && (entry.wetDeltaKg ?? 0) < 0),
  ) ?? null;
}

/** Shared by the ledger's edit affordance and the locked server command. */
export function formatFeedstockLossLockReason(blocker: FeedstockLedgerEntry, timeZone: string): string {
  if (blocker.reversed) return 'This entry has already been corrected. Open its correction instead.';
  const label = blocker.kind === 'run_draw' ? 'production run'
    : blocker.kind === 'ingredient_draw' ? 'product ingredient'
    : blocker.kind === 'count' ? 'stock count' : 'lost mass';
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
