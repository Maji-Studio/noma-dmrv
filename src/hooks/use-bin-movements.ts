/**
 * Bin Movements React Query Hooks (issue #194)
 *
 * Reconciliation history query + append-only stock-take / loss mutations.
 * Successful writes invalidate the storage-location caches so derived stock
 * (and the negative-stock badge) refresh immediately.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBinMovementsFn,
  recordLossFn,
  recordStockTakeFn,
} from "@/fn/bin-movements";
import type {
  RecordLossData,
  RecordStockTakeData,
} from "@/schemas/bin-movements";
import { storageLocationKeys } from "@/hooks/use-storage-locations";

/** Client-side carrier for a structured loss action field error. */
export class RecordLossFieldError extends Error {
  readonly field: "lossMassKg";

  constructor(message: string, field: "lossMassKg") {
    super(message);
    this.name = "RecordLossFieldError";
    this.field = field;
  }
}

export const binMovementKeys = {
  all: ["binMovements"] as const,
  byLocation: (storageLocationId: string) =>
    [...binMovementKeys.all, storageLocationId] as const,
};

/** Reconciliation history for a bin, newest first. */
export function useBinMovements(storageLocationId: string, enabled = true) {
  return useQuery({
    queryKey: binMovementKeys.byLocation(storageLocationId),
    queryFn: async () => {
      const result = await getBinMovementsFn(storageLocationId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!storageLocationId,
    staleTime: 15_000,
  });
}

/** Invalidate the caches a movement affects (history + all derived stock). */
function useInvalidateAfterMovement() {
  const queryClient = useQueryClient();
  return (storageLocationId: string) => {
    queryClient.invalidateQueries({
      queryKey: binMovementKeys.byLocation(storageLocationId),
    });
    // Derived stock lives on the storage-location lists/details.
    queryClient.invalidateQueries({ queryKey: storageLocationKeys.lists() });
    queryClient.invalidateQueries({
      queryKey: storageLocationKeys.detailWithFacility(storageLocationId),
    });
  };
}

export function useRecordStockTake() {
  const invalidate = useInvalidateAfterMovement();
  return useMutation({
    mutationFn: async (data: RecordStockTakeData) => {
      const result = await recordStockTakeFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: (_data, variables) => invalidate(variables.storageLocationId),
  });
}

export function useRecordLoss() {
  const invalidate = useInvalidateAfterMovement();
  return useMutation({
    mutationFn: async (data: RecordLossData) => {
      const result = await recordLossFn(data);
      if (!result.success) {
        if (result.field) {
          throw new RecordLossFieldError(result.error, result.field);
        }
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: (_data, variables) => invalidate(variables.storageLocationId),
  });
}
