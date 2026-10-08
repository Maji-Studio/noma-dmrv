import { patchArrayListCachesByPrefixWithSavedRow } from "./list-cache-utils";
import { StaleVersionError, throwActionError } from "@/lib/stale-version";
/**
 * Production Incidents React Query Hooks
 * Client-side state management for production incident CRUD
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProductionIncidentData,
  UpdateProductionIncidentData,
  DeleteProductionIncidentData,
} from "@/schemas/production-incidents";
import type { ProductionIncidentWithRelations } from "@/data-access/production-incidents";
import {
  getProductionIncidentsFn,
  createProductionIncidentFn,
  updateProductionIncidentFn,
  deleteProductionIncidentFn,
} from "@/fn/production-incidents";
import { productionRunKeys } from "@/hooks/use-production-runs";
import type { MutationCallbacks } from "./types";

const productionIncidentKeys = {
  all: ["productionIncidents"] as const,
  lists: () => [...productionIncidentKeys.all, "list"] as const,
  list: (productionRunId: string) =>
    [...productionIncidentKeys.lists(), productionRunId] as const,
};

export function useProductionIncidents(productionRunId: string | undefined) {
  return useQuery({
    queryKey: productionIncidentKeys.list(productionRunId ?? ""),
    queryFn: async () => {
      if (!productionRunId) return [];
      const result = await getProductionIncidentsFn(productionRunId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!productionRunId,
    staleTime: 30_000,
  });
}

export function useCreateProductionIncident(
  callbacks?: MutationCallbacks<
    ProductionIncidentWithRelations,
    CreateProductionIncidentData
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProductionIncidentData) => {
      const result = await createProductionIncidentFn(data);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productionIncidentKeys.list(variables.productionRunId),
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

export function useUpdateProductionIncident(
  callbacks?: MutationCallbacks<
    ProductionIncidentWithRelations,
    UpdateProductionIncidentData
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateProductionIncidentData) => {
      const result = await updateProductionIncidentFn(data);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: (data, variables) => {
      patchArrayListCachesByPrefixWithSavedRow<ProductionIncidentWithRelations>(queryClient, productionIncidentKeys.lists(), data);
      queryClient.invalidateQueries({
        queryKey: productionIncidentKeys.list(variables.productionRunId),
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

export function useDeleteProductionIncident(
  productionRunId: string | undefined,
  callbacks?: MutationCallbacks<void, DeleteProductionIncidentData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: DeleteProductionIncidentData) => {
      const result = await deleteProductionIncidentFn(data);
      if (!result.success) throwActionError(result);
    },
    onSuccess: (_data, variables) => {
      if (productionRunId) {
        queryClient.invalidateQueries({
          queryKey: productionIncidentKeys.list(productionRunId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.lists(),
      });
      callbacks?.onSuccess?.(undefined, variables);
    },
    onError: (error, variables) => {
      if (error instanceof StaleVersionError) queryClient.invalidateQueries({ queryKey: productionIncidentKeys.lists() });
      callbacks?.onError?.(error, variables);
    },
    onSettled: callbacks?.onSettled,
  });
}
