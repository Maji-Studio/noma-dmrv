"use client";

import { useQuery } from "@tanstack/react-query";
import { getEmissionAllocationFn } from "@/fn/emission-allocation";
import type { EmissionAllocationInput } from "@/types/emission-allocation";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { unwrap } from "./types";

/** One facility-wide read, anchored by either surface's stored record. */
export function useEmissionAllocation(input: EmissionAllocationInput | null) {
  return useQuery({
    queryKey: creditBatchKeys.emissionAllocation(input),
    queryFn: async () => unwrap(await getEmissionAllocationFn(input!)),
    enabled: input !== null,
    staleTime: 0,
  });
}
