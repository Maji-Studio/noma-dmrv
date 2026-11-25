/**
 * Failed-run returns (#439): the leftover material a Failed run puts back into
 * an uncarbonized feedstock bin. Reads for the run's view, and the two writes:
 * record a return, and correct one (a reversal with an optional replacement).
 * A save refreshes the run, its returns, the bins' stock and history, and the
 * storage summaries.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@/hooks/types";
import { feedstockBinStockKeys } from "@/hooks/feedstock-bin-stock-keys";
import { invalidateStockEntityQueries } from "@/hooks/entity-query-keys";
import { invalidateAfterFeedstockReplan } from "@/hooks/feedstock-replan-invalidation";
import { RECORD_LOCK_TOUCHES, recordLockMeta } from "@/hooks/record-lock-query-keys";
import { stockAvailabilityKeys } from "@/hooks/use-stock-availability";
import { storageLocationKeys } from "@/hooks/use-storage-locations";
import { productionRunKeys } from "@/hooks/use-production-runs";
import {
  correctProductionRunReturnFn,
  getProductionRunMaterialBalanceFn,
  getProductionRunReturnEligibilityFn,
  getProductionRunReturnRowsFn,
  recordProductionRunReturnFn,
} from "@/fn/production-run-returns";
import type { CorrectProductionRunReturnInput, RecordProductionRunReturnInput } from "@/schemas/production-run-returns";

export const productionRunReturnKeys = {
  all: ["productionRunReturns"] as const,
  rows: (runId: string) => [...productionRunReturnKeys.all, "rows", runId] as const,
  eligibility: (runId: string) => [...productionRunReturnKeys.all, "eligibility", runId] as const,
  balance: (runId: string) => [...productionRunReturnKeys.all, "balance", runId] as const,
};

/** The returns of one run, newest entries last, with who recorded each and what corrected it. */
export function useProductionRunReturns(runId: string, enabled = true) {
  return useQuery({
    queryKey: productionRunReturnKeys.rows(runId),
    queryFn: async () => unwrap(await getProductionRunReturnRowsFn(runId)),
    enabled: enabled && !!runId,
  });
}

/** Whether the run can take another return now, with the reason when it cannot. */
export function useProductionRunReturnEligibility(runId: string, enabled = true) {
  return useQuery({
    queryKey: productionRunReturnKeys.eligibility(runId),
    queryFn: async () => unwrap(await getProductionRunReturnEligibilityFn(runId)),
    enabled: enabled && !!runId,
  });
}

/** Consumed, returned and lost dry mass at the run boundary. */
export function useProductionRunMaterialBalance(runId: string, enabled = true) {
  return useQuery({
    queryKey: productionRunReturnKeys.balance(runId),
    queryFn: async () => unwrap(await getProductionRunMaterialBalanceFn(runId)),
    enabled: enabled && !!runId,
  });
}

function useInvalidateAfterReturn() {
  const queryClient = useQueryClient();
  return (runId: string, storageLocationIds: readonly string[]) => {
    void queryClient.invalidateQueries({ queryKey: productionRunReturnKeys.all });
    void queryClient.invalidateQueries({ queryKey: productionRunKeys.detail(runId) });
    void queryClient.invalidateQueries({ queryKey: productionRunKeys.linkedDetail(runId) });
    void queryClient.invalidateQueries({ queryKey: feedstockBinStockKeys.all });
    void queryClient.invalidateQueries({ queryKey: storageLocationKeys.lists() });
    for (const id of storageLocationIds) {
      void queryClient.invalidateQueries({ queryKey: storageLocationKeys.detailWithFacility(id) });
    }
    void queryClient.invalidateQueries({ queryKey: stockAvailabilityKeys.all });
    invalidateStockEntityQueries(queryClient, "binMovement");
    invalidateAfterFeedstockReplan(queryClient);
  };
}

export function useRecordProductionRunReturn() {
  const invalidate = useInvalidateAfterReturn();
  return useMutation({
    meta: recordLockMeta(RECORD_LOCK_TOUCHES.stock),
    mutationFn: async (data: RecordProductionRunReturnInput) => unwrap(await recordProductionRunReturnFn(data)),
    onSuccess: (_data, variables) => invalidate(variables.sourceProductionRunId, [variables.storageLocationId]),
  });
}

export function useCorrectProductionRunReturn() {
  const invalidate = useInvalidateAfterReturn();
  return useMutation({
    meta: recordLockMeta(RECORD_LOCK_TOUCHES.stock),
    mutationFn: async (data: CorrectProductionRunReturnInput) => unwrap(await correctProductionRunReturnFn(data)),
    onSuccess: (_data, variables) => invalidate(variables.sourceProductionRunId,
      [variables.storageLocationId, ...(variables.replacement ? [variables.replacement.storageLocationId] : [])]),
  });
}
