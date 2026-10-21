import { formatDateTime } from "@/lib/format-utils";
import { undatedLastSortingFn } from "./undated-last-sort";

/** Shown for a GHG Statement that has never been synced from the registry. */
export const NEVER_SYNCED_LABEL = "Never";

type SyncedAt = Date | string | null;

/** One line: the sync time, or "Never". */
export function lastSyncedText(value: SyncedAt): string {
  return value === null ? NEVER_SYNCED_LABEL : formatDateTime(value);
}

/** Chronological sort for the "Last synced" column; never-synced rows stay last in both directions. */
export function lastSyncedSortingFn<T extends { lastSyncedAt: SyncedAt }>(descending: boolean) {
  return undatedLastSortingFn<T>(
    (item) => (item.lastSyncedAt === null ? null : new Date(item.lastSyncedAt).getTime()),
    descending,
  );
}

export function LastSyncedCell({ value }: { value: SyncedAt }) {
  const synced = value !== null;
  return (
    <span
      {...(synced ? {} : { "data-empty": true })}
      className={
        synced
          ? "body-small text-[var(--color-text-primary)] whitespace-nowrap"
          : "body-small text-[var(--color-text-tertiary)] whitespace-nowrap"
      }
    >
      {lastSyncedText(value)}
    </span>
  );
}
