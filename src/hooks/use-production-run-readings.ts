/**
 * Production Run Readings React Query Hooks
 *
 * Readings are imported from readings CSVs. Client-side mutations are
 * limited to clearing all readings for a run ("delete all").
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProductionRunReadingsListFn,
  deleteAllProductionRunReadingsFn,
} from "@/fn/production-run-readings";
import { productionRunKeys } from "@/hooks/use-production-runs";
import { invalidateCertificationReadiness } from "@/hooks/use-certification";
import type { MutationCallbacks } from "./types";

// ============================================
// Query Keys
// ============================================

export const productionRunReadingKeys = {
  all: ["productionRunReadings"] as const,
  lists: () => [...productionRunReadingKeys.all, "list"] as const,
  list: (productionRunId?: string, facilityId?: string) =>
    [...productionRunReadingKeys.lists(), productionRunId, facilityId] as const,
};

// ============================================
// Query Hooks
// ============================================

export function useProductionRunReadings(
  productionRunId?: string,
  facilityId?: string
) {
  return useQuery({
    queryKey: productionRunReadingKeys.list(productionRunId, facilityId),
    queryFn: async () => {
      const result = await getProductionRunReadingsListFn(
        productionRunId,
        facilityId
      );
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000,
  });
}

// ============================================
// Mutation Hooks
// ============================================

/**
 * Delete every reading for a production run. Resolves to the number of rows
 * removed.
 */
export function useDeleteAllProductionRunReadings(
  callbacks?: MutationCallbacks<number, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productionRunId: string) => {
      const result = await deleteAllProductionRunReadingsFn({ productionRunId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data.deletedCount;
    },
    onSuccess: async (deletedCount, productionRunId) => {
      queryClient.invalidateQueries({
        queryKey: productionRunReadingKeys.lists(),
      });
      // Also refresh the inline readings cache keyed under production runs.
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.readings(productionRunId),
      });
      invalidateCertificationReadiness(queryClient);
      await callbacks?.onSuccess?.(deletedCount, productionRunId);
    },
    onError: async (error, productionRunId) => {
      await callbacks?.onError?.(error, productionRunId);
    },
  });
}
