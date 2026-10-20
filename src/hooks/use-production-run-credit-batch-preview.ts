"use client";

import { useQuery } from "@tanstack/react-query";
import { previewProductionRunCreditBatchFn } from "@/fn/production-runs";
import { unwrap } from "@/hooks/types";
import type { ProductionRunCreditBatchPreviewInput } from "@/schemas/production-run-credit-batch-preview";
import { creditBatchKeys } from "./credit-batch-query-keys";

/** Each form input owns its response; a previous input never supplies a placeholder. */
export function useProductionRunCreditBatchPreview(input: ProductionRunCreditBatchPreviewInput | null) {
  return useQuery({
    queryKey: creditBatchKeys.runPreview(input),
    enabled: input !== null,
    queryFn: async () => {
      if (!input) throw new Error("Credit batch preview input is required.");
      return unwrap(await previewProductionRunCreditBatchFn(input));
    },
    staleTime: 0,
    retry: false,
  });
}
