import { useQuery } from "@tanstack/react-query";
import { getBatchEmissionLinesFn } from "@/fn/emission-entries";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { unwrap } from "./types";

/** Read-only: the template lines of one credit batch with their states. */
export function useBatchEmissionLines(facilityId: string, creditBatchId: string, enabled = true) {
  return useQuery({
    queryKey: creditBatchKeys.emissionLines(facilityId, creditBatchId),
    queryFn: async () => unwrap(await getBatchEmissionLinesFn({ facilityId, creditBatchId })),
    enabled: enabled && !!facilityId && !!creditBatchId,
  });
}
