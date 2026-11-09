/**
 * The page header's credit batch filter: the list pages' outlined filter
 * select (`DataTable.FilterSelect`) with "All credit batches" and each batch,
 * newest first. The choice lives in the URL as `?batch=<id>`.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataTable } from "@/components/ui/data-table";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { creditBatchOptionLabel } from "@/lib/credit-batch-option-label";

const BATCH_PARAM = "batch";
const ALL_BATCHES = "All credit batches";
const SELECTED_BATCH = "Selected credit batch";
const BATCHES_LOAD_FAILED = "Could not load credit batches";
/** A value no batch id can take, for the disabled load-failed option. */
const LOAD_FAILED_OPTION = "load-failed";

/**
 * The chosen batch: the URL's `?batch=` when the facility lists that batch,
 * else null (all credit batches), so a stale, archived or other facility's id
 * falls back to all instead of failing the page. Undefined while the list loads;
 * if the list cannot load, the requested id stands and the read checks it.
 */
export function useSelectedBatchId(facilityId: string): string | null | undefined {
  const requested = useSearchParams().get(BATCH_PARAM);
  const { data: batches, isPending, isError } = useCreditBatches(facilityId);
  if (!requested) return null;
  // A failed lookup proves nothing about the batch: keep it, and the read refuses an unknown one.
  if (isError) return requested;
  if (isPending || !batches) return undefined;
  return batches.some((batch) => batch.id === requested) ? requested : null;
}

/** The current page without `?batch=`: "Show all credit batches". */
export function useAllBatchesHref(): string {
  const pathname = usePathname();
  const next = new URLSearchParams(useSearchParams().toString());
  next.delete(BATCH_PARAM);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function BatchFilter({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: batches = [], isLoading, isError } = useCreditBatches(facilityId);
  const selectedId = useSelectedBatchId(facilityId) ?? null;

  const choose = (batchId: string) => {
    const next = new URLSearchParams(params.toString());
    if (batchId) next.set(BATCH_PARAM, batchId);
    else next.delete(BATCH_PARAM);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <DataTable.FilterSelect
      aria-label="Filter by credit batch"
      className={PHONE_TOUCH_TARGET}
      value={selectedId ?? ""}
      disabled={isLoading}
      onChange={(event) => choose(event.target.value)}
    >
      <option value="">{ALL_BATCHES}</option>
      {/* The list failed to load but the URL names a batch: say it is selected, so the figures never sit under "All". */}
      {selectedId && !batches.some((batch) => batch.id === selectedId) && (
        <option value={selectedId}>{SELECTED_BATCH}</option>
      )}
      {isError && (
        <option value={LOAD_FAILED_OPTION} disabled>
          {BATCHES_LOAD_FAILED}
        </option>
      )}
      {batches.map((batch) => (
        <option key={batch.id} value={batch.id}>
          {creditBatchOptionLabel(batch)}
        </option>
      ))}
    </DataTable.FilterSelect>
  );
}
