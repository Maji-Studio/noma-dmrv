"use client";

import { useQuery } from "@tanstack/react-query";
import { loadRecordLocks } from "@/fn/record-locks";
import type { RecordLockView, RecordLockViewKind, RecordLockViews } from "@/lib/record-lock-view";
import { recordLockKeys } from "./record-lock-query-keys";
import { unwrap } from "./types";

const EMPTY: RecordLockViews = {};

/**
 * Open, In use or Sent for every id on one list page, in one call. Advisory:
 * the server decides on save, and a failed read leaves every action offered.
 */
export function useRecordLocks(entityType: RecordLockViewKind, ids: readonly (string | null | undefined)[]) {
  const present = [...new Set(ids.filter((id): id is string => !!id))];
  const query = useQuery({
    queryKey: recordLockKeys.batch(entityType, present),
    enabled: present.length > 0,
    queryFn: async () => unwrap(await loadRecordLocks(entityType, present)),
    placeholderData: (previous) => previous,
  });
  return { ...query, locks: query.data ?? EMPTY };
}

/** One record's lock, for its sheet. */
export function useRecordLock(entityType: RecordLockViewKind, id: string | null | undefined): {
  lock: RecordLockView | undefined;
  isLoading: boolean;
} {
  const { locks, isLoading } = useRecordLocks(entityType, [id]);
  return { lock: id ? locks[id] : undefined, isLoading };
}
