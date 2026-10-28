import type { Mutation, QueryClient } from "@tanstack/react-query";
import { isActionError } from "@/lib/action-error";
import { isInUseDeleteRefusal } from "@/lib/delete-refusal";
import type { RecordLockViewKind } from "@/lib/record-lock-view";

/** Record locks follow almost every write, so one prefix covers every kind. */
export const recordLockKeys = {
  all: ["record-locks"] as const,
  /** Prefix of every feedstock type link-lock read. */
  feedstockTypeLinks: () => [...recordLockKeys.all, "feedstockType"] as const,
  feedstockTypeLink: (id: string) => [...recordLockKeys.feedstockTypeLinks(), id] as const,
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
  facility: ["creditBatch", "removal"],
  emission: ["creditBatch", "removal"],
  transport: ["feedstock", "biocharProduct", "delivery", "sample", "productionRun"],
  document: ["feedstock", "productionRun", "biocharProduct", "delivery", "application", "sample", "creditBatch", "removal", "storageLocation", "order"],
  registry: "all",
} as const satisfies Record<string, RecordLockTouch>;

/** `meta` for a mutation hook: its writes and lock refusals refresh these lock reads. */
export function recordLockMeta(touch: RecordLockTouch | ((variables: unknown) => RecordLockTouch), options?: { onRefusalOnly?: boolean }) {
  return { recordLocks: touch, recordLocksOnRefusalOnly: options?.onRefusalOnly };
}

function failedResult(data: unknown): boolean {
  return typeof data === "object" && data !== null && "success" in data && (data as { success: unknown }).success === false;
}

/**
 * MutationCache hook: after a write, refetch only the mounted lock reads of
 * the kinds it declared. Ordinary writes also refresh after a certification
 * lock refusal. Refusal-only meta leaves every other outcome alone. Registry
 * writes (`"all"`) refresh on failure too: a failed or interrupted submission
 * can still leave a Removal holding its lineage.
 */
export function invalidateRecordLocksAfter(
  queryClient: QueryClient,
  data: unknown,
  error: unknown,
  mutation: Pick<Mutation<unknown, unknown, unknown, unknown>, "meta">,
  variables?: unknown,
) {
  const meta = mutation.meta as ReturnType<typeof recordLockMeta> | undefined;
  const touch = typeof meta?.recordLocks === "function" ? meta.recordLocks(variables) : meta?.recordLocks;
  if (!touch) return;
  const refused = (isActionError(error) && error.code === "certification_locked") || isInUseDeleteRefusal(error);
  if (meta?.recordLocksOnRefusalOnly && !refused) return;
  if (touch === "all") {
    void queryClient.invalidateQueries({ queryKey: recordLockKeys.all });
    return;
  }
  if (refused) {
    for (const kind of touch) void queryClient.invalidateQueries({ queryKey: recordLockKeys.kind(kind) });
    return;
  }
  if (error || failedResult(data)) return;
  for (const kind of touch) void queryClient.invalidateQueries({ queryKey: recordLockKeys.kind(kind) });
}
