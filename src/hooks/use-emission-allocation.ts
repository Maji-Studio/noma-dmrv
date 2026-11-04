"use client";

import { useQuery } from "@tanstack/react-query";
import { getEmissionAllocationFn } from "@/fn/emission-allocation";
import { throwActionError } from "@/lib/stale-version";
import type { EmissionAllocationInput } from "@/types/emission-allocation";
import { creditBatchKeys } from "./credit-batch-query-keys";

/** One facility-wide read, anchored by either surface's stored record. */
export function useEmissionAllocation(input: EmissionAllocationInput | null) {
  return useQuery({
    queryKey: creditBatchKeys.emissionAllocation(input),
    queryFn: async () => {
      const result = await getEmissionAllocationFn(input!);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    enabled: input !== null,
    staleTime: 0,
  });
}
