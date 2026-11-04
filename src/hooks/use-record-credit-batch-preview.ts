"use client";

import { useQuery } from "@tanstack/react-query";
import { previewRecordCreditBatchesFn } from "@/fn/record-credit-batches";
import type { RecordCreditBatchPreviewInput } from "@/schemas/record-credit-batches";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { unwrap } from "./types";

/**
 * The credit batches an unsaved record would join (#1350). Like the
 * Production Run preview, each input owns its answer: `gcTime: 0` drops it
 * once the inputs change, and returning to the tab checks again.
 */
export function useRecordCreditBatchPreview(input: RecordCreditBatchPreviewInput | null) {
  return useQuery({
    queryKey: creditBatchKeys.recordPreview(input),
    enabled: input !== null,
    queryFn: async () => {
      if (!input) throw new Error("Credit batch preview input is required.");
      return unwrap(await previewRecordCreditBatchesFn(input));
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
