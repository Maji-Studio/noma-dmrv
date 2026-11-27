"use client";

import { useQuery } from "@tanstack/react-query";
import { loadFacilityFailedRunEmissionTodosFn } from "@/fn/certification/failed-run-emission-todos";
import { unwrap } from "./types";
import { creditBatchKeys } from "./credit-batch-query-keys";

export function useFacilityFailedRunEmissionTodos(facilityId: string) {
  return useQuery({
    queryKey: creditBatchKeys.failedRunEmissionTodos(facilityId),
    queryFn: async () => unwrap(await loadFacilityFailedRunEmissionTodosFn(facilityId)),
    enabled: Boolean(facilityId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
