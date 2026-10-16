import type { ColumnDef } from "@tanstack/react-table";
import type { RecordLockViews } from "@/lib/record-lock-view";
import { RecordLockCell } from "./record-lock-chip";
import { RECORD_LOCK_LEVEL_LABELS } from "./record-lock-labels";

/** The "Lock" column every record list shares, fed by one batched read per page. */
export function recordLockColumn<T extends { id: string }>(locks: RecordLockViews): ColumnDef<T> {
  return {
    id: "recordLock",
    header: "Lock",
    meta: { nowrap: true },
    enableSorting: false,
    accessorFn: (row) => {
      const lock = locks[row.id];
      return lock ? RECORD_LOCK_LEVEL_LABELS[lock.level] : "";
    },
    cell: ({ row }) => <RecordLockCell lock={locks[row.original.id]} />,
  };
}
