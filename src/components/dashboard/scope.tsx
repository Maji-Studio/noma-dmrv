/**
 * The page header's credit batch filter: the list pages' outlined filter
 * select (`DataTable.FilterSelect`) with "All credit batches" and each batch,
 * newest first. The choice lives in the URL as `?batch=<id>`.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataTable } from "@/components/ui/data-table";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { creditBatchOptionLabel } from "@/lib/credit-batch-option-label";

const BATCH_PARAM = "batch";
const ALL_BATCHES = "All credit batches";

/** The chosen batch id from the URL; null means all credit batches. */
export function useSelectedBatchId(): string | null {
  return useSearchParams().get(BATCH_PARAM);
}

export function BatchFilter({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: batches = [], isLoading } = useCreditBatches(facilityId);
  const selectedId = batches.some((batch) => batch.id === params.get(BATCH_PARAM)) ? params.get(BATCH_PARAM) : null;

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
      value={selectedId ?? ""}
      disabled={isLoading}
      onChange={(event) => choose(event.target.value)}
    >
      <option value="">{ALL_BATCHES}</option>
      {batches.map((batch) => (
        <option key={batch.id} value={batch.id}>
          {creditBatchOptionLabel(batch)}
        </option>
      ))}
    </DataTable.FilterSelect>
  );
}
