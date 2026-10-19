import type { ColumnDef } from "@tanstack/react-table";
import type { RecordLockStatus, RecordLockViews } from "@/lib/record-lock-view";
import { RecordLockCell, RecordLockSentMark } from "./record-lock-chip";
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
 * The Sent lock icon right before a list's record link (`meta.recordLinkBefore`).
 * It sits outside the link and shows only when the record is Sent. Every other
 * row keeps an empty slot of the same width, so the codes stay aligned.
 */
export function recordLockTitleMark<T extends { id: string }>(locks: RecordLockViews) {
  return function titleMark(row: T) {
    // No placeholder for unsent rows: almost none are Sent, so a reserved slot is a blank gutter on every list.
    return locks[row.id]?.level === "sent" ? <RecordLockSentMark lock={locks[row.id]} /> : null;
  };
}
