/**
 * Production Run Readings React Query Hooks
 * Client-side state management for standalone reading CRUD
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductionRunReadingWithRelations } from "@/data-access/production-run-readings";
import type {
  CreateProductionRunReadingData,
  UpdateProductionRunReadingData,
} from "@/schemas/production-run-readings";
import {
  getProductionRunReadingsListFn,
  createProductionRunReadingFn,
  updateProductionRunReadingFn,
  deleteProductionRunReadingFn,
} from "@/fn/production-run-readings";
import { productionRunKeys } from "@/hooks/use-production-runs";
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

export function useCreateProductionRunReading(
  callbacks?: MutationCallbacks<
    ProductionRunReadingWithRelations,
    CreateProductionRunReadingData
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProductionRunReadingData) => {
      const result = await createProductionRunReadingFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: async (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productionRunReadingKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.readings(data.productionRunId),
      });
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      await callbacks?.onError?.(error, variables);
    },
  });
}

export function useUpdateProductionRunReading(
  callbacks?: MutationCallbacks<
    ProductionRunReadingWithRelations,
    UpdateProductionRunReadingData
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateProductionRunReadingData) => {
      const result = await updateProductionRunReadingFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: async (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productionRunReadingKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.readings(data.productionRunId),
      });
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      await callbacks?.onError?.(error, variables);
    },
  });
}

export function useDeleteProductionRunReading(
  callbacks?: MutationCallbacks<void, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (readingId: string) => {
      const result = await deleteProductionRunReadingFn({ readingId });
      if (!result.success) {
        throw new Error(result.error);
      }
    },
    onSuccess: async (_, readingId) => {
      queryClient.invalidateQueries({
        queryKey: productionRunReadingKeys.lists(),
      });
      // Also invalidate the inline readings cache
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.all,
      });
      await callbacks?.onSuccess?.(undefined, readingId);
    },
    onError: async (error, readingId) => {
      await callbacks?.onError?.(error, readingId);
    },
  });
}
