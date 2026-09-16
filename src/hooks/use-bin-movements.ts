import { outputStockKeys } from "./use-output-stock";
/**
 * Bin Movements React Query Hooks (issue #194)
 *
 * Reconciliation history query + append-only stock-take / loss mutations.
 * Successful writes invalidate the storage-location caches so derived stock
 * (and the negative-stock badge) refresh immediately.
 */

import {
  getBinMovementsFn,
  recordLossFn,
  recordStockTakeFn,
} from "@/fn/bin-movements";
import { storageLocationKeys } from "@/hooks/use-storage-locations";
import type {
  RecordLossData,
  RecordStockTakeData,
} from "@/schemas/bin-movements";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateStockEntityQueries } from "./entity-query-keys";

/** Client-side carrier for a structured loss action field error. */
export class RecordLossFieldError extends Error {
  readonly field: "lossMassKg";

  constructor(message: string, field: "lossMassKg") {
    super(message);
    this.name = "RecordLossFieldError";
    this.field = field;
  }
}

/** The blocking record a conflicting loss request points back at. */
export interface RecordLossConflict {
  entity: string;
  id: string;
  code: string;
}

/**
 * Client-side carrier for a loss request-key conflict (issue #773).
 *
 * The action answers a reused key with `{ conflict }` per the `ActionResult`
 * contract; the form needs that payload to rotate its key so an edited
 * resubmit is a fresh request instead of the same conflict again.
 */
export class RecordLossConflictError extends Error {
  readonly conflict: RecordLossConflict;

  constructor(message: string, conflict: RecordLossConflict) {
    super(message);
    this.name = "RecordLossConflictError";
    this.conflict = conflict;
  }
}

/** Turn a failed loss action into a thrown error, keeping its structure. */
export function throwRecordLossError(result: {
  error: string;
  field?: "lossMassKg";
  conflict?: RecordLossConflict;
}): never {
  if (result.field) {
    throw new RecordLossFieldError(result.error, result.field);
  }
  if (result.conflict) {
    throw new RecordLossConflictError(result.error, result.conflict);
  }
  throw new Error(result.error);
}

/** Client-side carrier for a structured stock-take action field error. */
export class RecordStockTakeFieldError extends Error {
  readonly field: "counted";

  constructor(message: string) {
    super(message);
    this.name = "RecordStockTakeFieldError";
    this.field = "counted";
  }
}

const binMovementKeys = {
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
    void queryClient.invalidateQueries({ queryKey: outputStockKeys.all });
    invalidateStockEntityQueries(queryClient, "binMovement");
  };
}

export function useRecordStockTake() {
  const invalidate = useInvalidateAfterMovement();
  return useMutation({
    mutationFn: async (data: RecordStockTakeData) => {
      const result = await recordStockTakeFn(data);
      if (!result.success) {
        if (result.field) {
          throw new RecordStockTakeFieldError(result.error);
        }
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
        throwRecordLossError(result);
      }
      return result.data;
    },
    onSuccess: (_data, variables) => invalidate(variables.storageLocationId),
  });
}
