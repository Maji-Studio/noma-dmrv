"use client";

import { useQueries } from "@tanstack/react-query";
import { loadRecordLocks } from "@/fn/record-locks";
import {
  RECORD_LOCK_VIEW_MAX_IDS,
  type RecordLockStatus,
  type RecordLockView,
  type RecordLockViewKind,
  type RecordLockViews,
} from "@/lib/record-lock-view";
import { recordLockKeys } from "./record-lock-query-keys";
import { unwrap } from "./types";

function chunk(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += RECORD_LOCK_VIEW_MAX_IDS) {
    chunks.push(ids.slice(start, start + RECORD_LOCK_VIEW_MAX_IDS));
  }
  return chunks;
}

/**
 * Open, In use or Sent for every id on one list, in one call per 200 ids, so
 * a long list never fails as a whole. Screens fail closed: until an id's
 * lock answers, Edit and Delete are not offered.
 */
export function useRecordLocks(entityType: RecordLockViewKind, ids: readonly (string | null | undefined)[]): {
  locks: RecordLockViews;
  statusOf: (id: string) => RecordLockStatus;
} {
  const chunks = chunk([...new Set(ids.filter((id): id is string => !!id))].sort());
  const queries = useQueries({
    queries: chunks.map((part) => ({
      queryKey: recordLockKeys.batch(entityType, part),
      queryFn: async () => unwrap(await loadRecordLocks(entityType, part)),
    })),
  });
  const locks: RecordLockViews = Object.assign({}, ...queries.map((query) => query.data ?? {}));
  const statusOf = (id: string): RecordLockStatus => {
    const index = chunks.findIndex((part) => part.includes(id));
    if (index < 0) return "pending";
    const query = queries[index];
    if (query.data && id in query.data) return "ready";
    if (query.isError) return "error";
    return query.isPending || query.isFetching ? "pending" : "ready";
  };
  return { locks, statusOf };
}

/** One record's lock, for its sheet, with whether it has answered yet. */
export function useRecordLock(entityType: RecordLockViewKind, id: string | null | undefined): {
  lock: RecordLockView | undefined;
  status: RecordLockStatus;
} {
  const { locks, statusOf } = useRecordLocks(entityType, [id]);
  return { lock: id ? locks[id] : undefined, status: id ? statusOf(id) : "ready" };
}
