import { formatFacilityDateTime } from "@/lib/format-utils";
import { undatedLastSortingFn } from "./undated-last-sort";

/** Shown for a GHG Statement that has never been synced from the registry. */
export const NEVER_SYNCED_LABEL = "Never";

type SyncedAt = Date | string | null;

/** One line: the sync time, or "Never". */
export function lastSyncedText(value: SyncedAt, timeZone: string): string {
  return value === null ? NEVER_SYNCED_LABEL : formatFacilityDateTime(value, timeZone);
}

/** Chronological sort for the "Last synced" column; never-synced rows stay last in both directions. */
export function lastSyncedSortingFn<T extends { lastSyncedAt: SyncedAt }>(descending: boolean) {
  return undatedLastSortingFn<T>(
    (item) => (item.lastSyncedAt === null ? null : new Date(item.lastSyncedAt).getTime()),
    descending,
  );
}

export function LastSyncedCell({ value, timeZone }: { value: SyncedAt; timeZone: string }) {
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
      {lastSyncedText(value, timeZone)}
    </span>
  );
}
