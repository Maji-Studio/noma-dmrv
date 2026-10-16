import type { QueryClient } from "@tanstack/react-query";
import type { RecordLockViewKind } from "@/lib/record-lock-view";

/** Record locks follow almost every write, so one prefix covers every kind. */
export const recordLockKeys = {
  all: ["record-locks"] as const,
  kind: (entityType: RecordLockViewKind) => [...recordLockKeys.all, entityType] as const,
  /** Ids are sorted so one page re-read in another order shares the cache. */
  batch: (entityType: RecordLockViewKind, ids: readonly string[]) =>
    [...recordLockKeys.kind(entityType), [...ids].sort()] as const,
};

/**
 * Any saved write can add or remove a dependency or change a Removal, and a
 * registry refresh can reopen a record, so locks refetch after every settled
 * mutation. Only mounted lock reads refetch.
 */
export function invalidateRecordLocks(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: recordLockKeys.all });
}
