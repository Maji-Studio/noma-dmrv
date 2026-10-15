import type { ActionResult } from "@/types/actions";
import type { DeleteApplicationInput } from "@/schemas/application-input";
import { StaleVersionError, throwActionError } from "@/lib/stale-version";
import { patchListCachesWithSavedRow } from "./list-cache-utils";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getApplicationsFn,
  getApplicationDeliveryOptionsFn,
  createApplicationFn,
  updateApplicationFn,
  deleteApplicationFn,
} from "@/fn/applications";
import { creditBatchKeys } from "@/hooks/use-credit-batches";
import { invalidateCertificationReadiness } from "@/hooks/use-certification";
import type { ApplicationFormData } from "@/schemas/applications";
import type { ApplicationListOptions } from "@/data-access/applications";
import { unwrap } from "@/hooks/types";

const EXACT_ID_CHUNK_SIZE = 100;

/**
 * Query key factory for applications
 */
export const applicationKeys = {
  all: ["applications"] as const,
  lists: () => [...applicationKeys.all, "list"] as const,
  list: (filters?: ApplicationListOptions) =>
    [...applicationKeys.lists(), filters] as const,
  deliveryOptions: (facilityId?: string) =>
    [...applicationKeys.all, "deliveryOptions", facilityId] as const,
  details: () => [...applicationKeys.all, "detail"] as const,
  detail: (id: string) => [...applicationKeys.details(), id] as const,
};

/**
 * Query hook for fetching applications with pagination
 */
export function useApplications(
  options?: ApplicationListOptions,
  queryOptions?: { enabled?: boolean },
) {
  const exactIds = options?.ids ?? [];
  const requests = exactIds.length > 0
    ? Array.from(
        { length: Math.ceil(exactIds.length / EXACT_ID_CHUNK_SIZE) },
        (_, index) => {
          const ids = exactIds.slice(
            index * EXACT_ID_CHUNK_SIZE,
            (index + 1) * EXACT_ID_CHUNK_SIZE,
          );
          return { ...options, ids, page: 1, pageSize: ids.length };
        },
      )
    : [options];
  const results = useQueries({
    queries: requests.map((request) => ({
      queryKey: applicationKeys.list(request),
      queryFn: async () => unwrap(await getApplicationsFn(request)),
      staleTime: 30000,
      enabled: queryOptions?.enabled,
    })),
  });

  const items = results.flatMap((result) => result.data?.items ?? []);
  return {
    data: exactIds.length > 0
      ? {
          items,
          total: items.length,
          page: 1,
          pageSize: Math.max(items.length, 1),
          totalPages: items.length > 0 ? 1 : 0,
        }
      : results[0]?.data,
    isLoading: results.some((result) => result.isLoading),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

export function useApplicationDeliveryOptions(
  facilityId?: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: applicationKeys.deliveryOptions(facilityId),
    queryFn: async () => unwrap(await getApplicationDeliveryOptionsFn(facilityId)),
    staleTime: 30000,
    enabled: options?.enabled,
  });
}

/**
 * Mutation hook for creating an application
 */
export function useCreateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ApplicationFormData) => createApplicationFn(applicationOperationInput(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: [...applicationKeys.all, "deliveryOptions"],
      });
      // A new application can join a credit batch's roll-up; the batch
      // membership isn't known here, so invalidate the whole credit-batch
      // scope rather than guessing a single detail key.
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.all });
      invalidateCertificationReadiness(queryClient);
    },
  });
}

/**
 * Mutation hook for updating an application
 */
export function useUpdateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ApplicationFormData & { applicationId: string; expectedVersion: number; code?: string }): Promise<Awaited<ReturnType<typeof updateApplicationFn>>> => {
      const result = await updateApplicationFn({ ...applicationOperationInput(data), applicationId: data.applicationId, expectedVersion: data.expectedVersion, code: data.code });
      if (!result.success) throwActionError(result);
      return result;
    },
    onSuccess: (result) => {
      if (result.success) patchListCachesWithSavedRow(queryClient, applicationKeys.lists(), result.data);
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: [...applicationKeys.all, "deliveryOptions"],
      });
      if (result.success && result.data) {
        queryClient.setQueryData(applicationKeys.detail(result.data.id), (old: object | undefined) => old ? { ...old, ...result.data } : old);
        queryClient.invalidateQueries({
          queryKey: applicationKeys.detail(result.data.id),
        });
      }
      // Application edits (e.g. applied mass) shift the owning credit
      // batch's derived figures; batch membership isn't known here, so
      // invalidate the whole credit-batch scope rather than guessing.
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.all });
      invalidateCertificationReadiness(queryClient);
    },
  });
}

/**
 * Mutation hook for deleting an application
 */
export function useDeleteApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: DeleteApplicationInput): Promise<ActionResult<void>> => {
      const result = await deleteApplicationFn(data);
      if (!result.success) throwActionError(result);
      return result;
    },
    onError: (error, variables) => {
      if (error instanceof StaleVersionError) {
        queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
        queryClient.invalidateQueries({ queryKey: applicationKeys.detail(variables.applicationId) });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: [...applicationKeys.all, "deliveryOptions"],
      });
      // Deleting an application removes it from any credit batch roll-up
      // it belonged to; batch membership isn't known here, so invalidate
      // the whole credit-batch scope rather than guessing.
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.all });
      invalidateCertificationReadiness(queryClient);
    },
  });
}

function applicationOperationInput(data: ApplicationFormData) {
  const { biocharAppliedKg, applicationMethodType, ...fields } = data;
  return { ...fields, appliedWetMassKg: biocharAppliedKg, applicationMethod: applicationMethodType };
}
