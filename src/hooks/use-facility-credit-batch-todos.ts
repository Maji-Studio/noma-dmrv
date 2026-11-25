"use client";

import { useQuery } from "@tanstack/react-query";
import { loadFacilityCreditBatchTodosFn } from "@/fn/certification/credit-batch-todos";
import { unwrap } from "./types";
import { creditBatchKeys } from "./credit-batch-query-keys";

export function useFacilityCreditBatchTodos(facilityId: string) {
  return useQuery({
    queryKey: creditBatchKeys.facilityTodos(facilityId),
    queryFn: async () => unwrap(await loadFacilityCreditBatchTodosFn(facilityId)),
    enabled: Boolean(facilityId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
