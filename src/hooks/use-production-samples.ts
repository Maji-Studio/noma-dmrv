/**
 * Production Samples React Query Hooks
 * Client-side state management for in-process sample operations
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProductionSampleData,
  UpdateProductionSampleData,
} from "@/schemas/production-samples";
import type { ProductionSampleWithRelations } from "@/data-access/production-samples";
import {
  getProductionSamplesFn,
  createProductionSampleFn,
  updateProductionSampleFn,
  deleteProductionSampleFn,
} from "@/fn/production-samples";
import { productionRunKeys } from "@/hooks/use-production-runs";
import type { MutationCallbacks } from "./types";

// ============================================
// Query Keys
// ============================================

export const productionSampleKeys = {
  all: ["productionSamples"] as const,
  lists: () => [...productionSampleKeys.all, "list"] as const,
  list: (productionRunId: string) =>
    [...productionSampleKeys.lists(), productionRunId] as const,
};

// ============================================
// Query Hooks
// ============================================

/**
 * Fetch all production samples for a specific production run
 */
export function useProductionSamples(productionRunId: string | undefined) {
  return useQuery({
    queryKey: productionSampleKeys.list(productionRunId ?? ""),
    queryFn: async () => {
      if (!productionRunId) return [];
      const result = await getProductionSamplesFn(productionRunId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!productionRunId,
    staleTime: 30_000,
  });
}

// ============================================
// Mutation Hooks
// ============================================

/**
 * Create a new production sample
 */
export function useCreateProductionSample(
  callbacks?: MutationCallbacks<
    ProductionSampleWithRelations,
    CreateProductionSampleData
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProductionSampleData) => {
      const result = await createProductionSampleFn(data);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productionSampleKeys.list(variables.productionRunId),
      });
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.lists(),
      });
      callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
    onSettled: callbacks?.onSettled,
  });
}

/**
 * Update an existing production sample
 */
export function useUpdateProductionSample(
  callbacks?: MutationCallbacks<
    ProductionSampleWithRelations,
    UpdateProductionSampleData
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateProductionSampleData) => {
      const result = await updateProductionSampleFn(data);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productionSampleKeys.list(variables.productionRunId),
      });
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.lists(),
      });
      callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
    onSettled: callbacks?.onSettled,
  });
}

/**
 * Delete a production sample
 */
export function useDeleteProductionSample(
  productionRunId: string | undefined,
  callbacks?: MutationCallbacks<void, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productionSampleId: string) => {
      const result = await deleteProductionSampleFn({ productionSampleId });
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: (_data, variables) => {
      if (productionRunId) {
        queryClient.invalidateQueries({
          queryKey: productionSampleKeys.list(productionRunId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.lists(),
      });
      callbacks?.onSuccess?.(undefined, variables);
    },
    onError: callbacks?.onError,
    onSettled: callbacks?.onSettled,
  });
}
