"use client";

import { useQuery } from "@tanstack/react-query";
import { getRecordCreditBatchesFn } from "@/fn/record-credit-batches";
import type { RecordCreditBatchesInput } from "@/schemas/record-credit-batches";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { unwrap } from "./types";

/** Unsaved records never call the server, including an explicit refetch. */
export function useRecordCreditBatches(kind: RecordCreditBatchesInput["kind"], id?: string | null) {
  return useQuery({
    queryKey: creditBatchKeys.record(kind, id),
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error("A saved record ID is required.");
      return unwrap(await getRecordCreditBatchesFn({ kind, id }));
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
