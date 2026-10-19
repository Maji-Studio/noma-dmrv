import type { ColumnDef } from "@tanstack/react-table";
import type { RecordLockStatus, RecordLockViews } from "@/lib/record-lock-view";
import { RecordLockCell } from "./record-lock-chip";
import { RECORD_LOCK_LEVEL_LABELS } from "./record-lock-labels";

/** The "Lock" column every record list shares (Sent chips only), fed by one batched read per page. */
export function recordLockColumn<T extends { id: string }>(
  locks: RecordLockViews,
  statusOf: (id: string) => RecordLockStatus = () => "ready",
): ColumnDef<T> {
  return {
    id: "recordLock",
    header: "Lock",
    meta: { nowrap: true },
    enableSorting: false,
    accessorFn: (row) => {
      const lock = locks[row.id];
      return lock?.level === "sent" ? RECORD_LOCK_LEVEL_LABELS[lock.level] : "";
    },
    cell: ({ row }) => <RecordLockCell lock={locks[row.original.id]} status={statusOf(row.original.id)} />,
  };
}
