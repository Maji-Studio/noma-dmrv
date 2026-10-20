import type { Row } from "@tanstack/react-table";
import { formatDateTime } from "@/lib/format-utils";

/** Shown for a GHG Statement that has never been synced from the registry. */
export const NEVER_SYNCED_LABEL = "Never";

type SyncedAt = Date | string | null;

/** One line: the sync time, or "Never". */
export function lastSyncedText(value: SyncedAt): string {
  return value === null ? NEVER_SYNCED_LABEL : formatDateTime(value);
}

/** Column value: the time text, or undefined for a never-synced row so it sorts last. */
export function lastSyncedSortValue(value: SyncedAt): string | undefined {
  return value === null ? undefined : lastSyncedText(value);
}

/**
 * Chronological sort for the "Last synced" column. Pair it with
 * `sortUndefined: "last"` and `lastSyncedSortValue`, so never-synced rows stay
 * after every synced row in both directions.
 */
export function lastSyncedSortingFn<T extends { lastSyncedAt: SyncedAt }>(
  a: Row<T>,
  b: Row<T>,
): number {
  const time = (row: Row<T>) =>
    row.original.lastSyncedAt === null ? 0 : new Date(row.original.lastSyncedAt).getTime();
  return time(a) - time(b);
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
