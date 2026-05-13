/**
 * Transport Legs React Query Hooks
 *
 * Polymorphic CRUD hooks for the `transport_legs` table. Query keys are
 * scoped by `(entityType, entityId)` so the same hook drives delivery,
 * feedstock-delivery, biochar-product, and sample surfaces.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransportLegFn,
  deleteTransportLegFn,
  getTransportLegsForEntityFn,
  updateTransportLegFn,
} from "@/fn/transport-legs";
import type {
  CreateTransportLegData,
  TransportEntityTypeValue,
  UpdateTransportLegData,
} from "@/schemas/transport-legs";
import type { TransportLeg } from "@/db/schema";
import type { MutationCallbacks } from "./types";

// ============================================
// Query Keys
// ============================================

export const transportLegKeys = {
  all: ["transportLegs"] as const,
  byEntity: (entityType: TransportEntityTypeValue, entityId: string) =>
    [...transportLegKeys.all, entityType, entityId] as const,
};

// ============================================
// Query Hooks
// ============================================

export function useTransportLegsForEntity(
  entityType: TransportEntityTypeValue,
  entityId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: transportLegKeys.byEntity(entityType, entityId ?? ""),
    queryFn: async (): Promise<TransportLeg[]> => {
      if (!entityId) return [];
      const result = await getTransportLegsForEntityFn({ entityType, entityId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: options?.enabled !== false && !!entityId,
    staleTime: 30000,
  });
}

// ============================================
// Mutation Hooks
// ============================================

export function useCreateTransportLeg(
  callbacks?: MutationCallbacks<TransportLeg, CreateTransportLegData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTransportLegData): Promise<TransportLeg> => {
      const result = await createTransportLegFn(input);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: transportLegKeys.byEntity(
          variables.entityType,
          variables.entityId,
        ),
      });
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
    onMutate: callbacks?.onMutate,
    onSettled: callbacks?.onSettled,
  });
}

export function useUpdateTransportLeg(
  /** Caller must supply the (entityType, entityId) the leg belongs to so the
   *  list query is invalidated on success. */
  entityType: TransportEntityTypeValue,
  entityId: string,
  callbacks?: MutationCallbacks<TransportLeg, UpdateTransportLegData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTransportLegData): Promise<TransportLeg> => {
      const result = await updateTransportLegFn(input);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: transportLegKeys.byEntity(entityType, entityId),
      });
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
    onMutate: callbacks?.onMutate,
    onSettled: callbacks?.onSettled,
  });
}

export function useDeleteTransportLeg(
  entityType: TransportEntityTypeValue,
  entityId: string,
  callbacks?: MutationCallbacks<void, { id: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }): Promise<void> => {
      const result = await deleteTransportLegFn(input);
      if (!result.success) {
        throw new Error(result.error);
      }
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: transportLegKeys.byEntity(entityType, entityId),
      });
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
    onMutate: callbacks?.onMutate,
    onSettled: callbacks?.onSettled,
  });
}
