import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransportLegFn,
  deleteTransportLegFn,
  getTransportLegsForEntityFn,
  updateTransportLegFn,
} from "@/fn/transport-legs";
// Type-only: compile-time import across the fn layer is safe; a runtime
// re-export from the "use server" module breaks Next's server-actions
// transform (every export is wrapped as an action reference).
import type { TransportLegWithEvidence } from "@/data-access/transport-legs";
import type {
  CreateTransportLegData,
  TransportEntityTypeValue,
  UpdateTransportLegData,
} from "@/schemas/transport-legs";
import type { TransportLeg } from "@/db/schema";
import type { MutationCallbacks } from "./types";
import { dashboardOverviewKeys } from "./use-dashboard-overview";
import { certificationKeys } from "./use-certification";

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
    queryFn: async (): Promise<TransportLegWithEvidence[]> => {
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
      await queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      // Leg distance/provenance edits change certification readiness; leaving
      // the certification family fresh shows pre-mutation readiness for 30s.
      await queryClient.invalidateQueries({ queryKey: certificationKeys.all });
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
    onMutate: callbacks?.onMutate,
    onSettled: callbacks?.onSettled,
  });
}

export function useUpdateTransportLeg(
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
      await queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      // Leg distance/provenance edits change certification readiness; leaving
      // the certification family fresh shows pre-mutation readiness for 30s.
      await queryClient.invalidateQueries({ queryKey: certificationKeys.all });
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
      await queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      // Leg distance/provenance edits change certification readiness; leaving
      // the certification family fresh shows pre-mutation readiness for 30s.
      await queryClient.invalidateQueries({ queryKey: certificationKeys.all });
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
    onMutate: callbacks?.onMutate,
    onSettled: callbacks?.onSettled,
  });
}
