"use client";

import { useQueries } from "@tanstack/react-query";
import { getRecordLocksRead } from "@/lib/read-api/client";
import {
  RECORD_LOCK_VIEW_MAX_IDS,
  type RecordLockStatus,
  type RecordLockView,
  type RecordLockViewKind,
  type RecordLockViews,
} from "@/lib/record-lock-view";
import { recordLockKeys } from "./record-lock-query-keys";
import { unwrap } from "./types";

/** Ids compare lower-case everywhere, as PostgreSQL returns them. */
function canonical(id: string): string {
  return id.toLowerCase();
}

function chunk(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += RECORD_LOCK_VIEW_MAX_IDS) {
    chunks.push(ids.slice(start, start + RECORD_LOCK_VIEW_MAX_IDS));
  }
  return chunks;
}

/**
 * Open, In use or Sent for every id on one list: one `/api/reads` request per
 * 200 ids, so a long list never fails as a whole. Screens fail closed: an id
 * whose read has not answered, or whose latest read failed (even with older
 * cached data), offers no Edit or Delete.
 */
export function useRecordLocks(entityType: RecordLockViewKind, ids: readonly (string | null | undefined)[]): {
  locks: RecordLockViews;
  statusOf: (id: string) => RecordLockStatus;
} {
  const chunks = chunk([...new Set(ids.filter((id): id is string => !!id).map(canonical))].sort());
  const queries = useQueries({
    queries: chunks.map((part) => ({
      queryKey: recordLockKeys.batch(entityType, part),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        unwrap(await getRecordLocksRead({ entityType, ids: part }, { signal })),
    })),
  });
  // A failed refresh never lets stale cached locks authorize an action.
  const locks: RecordLockViews = Object.assign({}, ...queries.map((query) => (query.isError ? {} : query.data ?? {})));
  const statusOf = (id: string): RecordLockStatus => {
    const key = canonical(id);
    const index = chunks.findIndex((part) => part.includes(key));
    if (index < 0) return "pending";
    const query = queries[index];
    if (query.isError) return "error";
    if (query.data && key in query.data) return "ready";
    return query.isPending || query.isFetching ? "pending" : "ready";
  };
  return {
    locks: new Proxy(locks, { get: (target, prop) => (typeof prop === "string" ? target[canonical(prop)] : undefined) }),
    statusOf,
  };
}

/** One record's lock, for its sheet, with whether it has answered yet. */
export function useRecordLock(entityType: RecordLockViewKind, id: string | null | undefined): {
  lock: RecordLockView | undefined;
  status: RecordLockStatus;
} {
  const { locks, statusOf } = useRecordLocks(entityType, [id]);
  return { lock: id ? locks[id] : undefined, status: id ? statusOf(id) : "ready" };
}
