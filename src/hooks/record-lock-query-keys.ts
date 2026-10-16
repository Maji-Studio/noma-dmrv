import type { Mutation, QueryClient } from "@tanstack/react-query";
import type { RecordLockViewKind } from "@/lib/record-lock-view";

/** Record locks follow almost every write, so one prefix covers every kind. */
export const recordLockKeys = {
  all: ["record-locks"] as const,
  kind: (entityType: RecordLockViewKind) => [...recordLockKeys.all, entityType] as const,
  /** Ids are sorted so one page re-read in another order shares the cache. */
  batch: (entityType: RecordLockViewKind, ids: readonly string[]) =>
    [...recordLockKeys.kind(entityType), [...ids].sort()] as const,
};

/** The record kinds whose locks a mutation can change, or every kind. */
export type RecordLockTouch = readonly RecordLockViewKind[] | "all";

/**
 * Which lock reads each write family can change: its own kind, the records it
 * uses (a delivery makes its order In use) and the bins it posts to. Registry
 * writes (submit, refresh, sync) can change Sent anywhere in a lineage.
 */
export const RECORD_LOCK_TOUCHES = {
  feedstock: ["feedstock", "storageLocation"],
  productionRun: ["productionRun", "feedstock", "storageLocation", "creditBatch"],
  biocharProduct: ["biocharProduct", "productionRun", "storageLocation"],
  order: ["order"],
  delivery: ["delivery", "order", "biocharProduct", "productionRun", "storageLocation"],
  application: ["application", "delivery", "creditBatch", "removal"],
  sample: ["sample", "creditBatch"],
  creditBatch: ["creditBatch", "productionRun", "sample", "application"],
  storageLocation: ["storageLocation"],
  stock: ["storageLocation", "feedstock", "productionRun", "biocharProduct", "delivery"],
  registry: "all",
} as const satisfies Record<string, RecordLockTouch>;

/** `meta` for a mutation hook: its successful writes refresh these lock reads. */
export function recordLockMeta(touch: RecordLockTouch) {
  return { recordLocks: touch };
}

function failedResult(data: unknown): boolean {
  return typeof data === "object" && data !== null && "success" in data && (data as { success: unknown }).success === false;
}

/**
 * MutationCache hook: after a write commits, refetch only the mounted lock
 * reads of the kinds it declared. Failed writes and undeclared ones refetch
 * nothing.
 */
export function invalidateRecordLocksAfter(
  queryClient: QueryClient,
  data: unknown,
  mutation: Pick<Mutation<unknown, unknown, unknown, unknown>, "meta">,
) {
  const touch = (mutation.meta as { recordLocks?: RecordLockTouch } | undefined)?.recordLocks;
  if (!touch || failedResult(data)) return;
  if (touch === "all") {
    void queryClient.invalidateQueries({ queryKey: recordLockKeys.all });
    return;
  }
  for (const kind of touch) void queryClient.invalidateQueries({ queryKey: recordLockKeys.kind(kind) });
}
