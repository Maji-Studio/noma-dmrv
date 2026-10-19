import type { ColumnDef } from "@tanstack/react-table";
import type { RecordLockStatus, RecordLockViews } from "@/lib/record-lock-view";
import { RecordLockCell, RecordLockOverviewChip } from "./record-lock-chip";
import { RECORD_LOCK_LEVEL_LABELS } from "./record-lock-labels";

/** The "Lock" column every record list shares (Sent chips only, hidden until turned on under Columns), fed by one batched read per page. */
export function recordLockColumn<T extends { id: string }>(
  locks: RecordLockViews,
  statusOf: (id: string) => RecordLockStatus = () => "ready",
): ColumnDef<T> {
  return {
    id: "recordLock",
    header: "Lock",
    meta: { nowrap: true, hiddenByDefault: true },
    enableSorting: false,
    accessorFn: (row) => {
      const lock = locks[row.id];
      return lock?.level === "sent" ? RECORD_LOCK_LEVEL_LABELS[lock.level] : "";
    },
    cell: ({ row }) => <RecordLockCell lock={locks[row.original.id]} status={statusOf(row.original.id)} />,
  };
}

/**
 * The Sent mark right after a list's record link (`meta.recordLinkAfter`).
 * It sits outside the link and shows nothing unless the record is Sent.
 */
export function recordLockTitleMark<T extends { id: string }>(locks: RecordLockViews) {
  return function titleMark(row: T) {
    return <RecordLockOverviewChip lock={locks[row.id]} className="shrink-0" />;
  };
}
