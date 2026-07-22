import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getApplicationsFn,
  getApplicationByIdFn,
  getApplicationDeliveryOptionsFn,
  createApplicationFn,
  updateApplicationFn,
  deleteApplicationFn,
} from "@/fn/applications";
import { creditBatchKeys } from "@/hooks/use-credit-batches";
import { invalidateCertificationReadiness } from "@/hooks/use-certification";
import type { ApplicationFormData, UpdateApplicationData } from "@/schemas/applications";

const EXACT_ID_CHUNK_SIZE = 100;

/**
 * Query key factory for applications
 */
export const applicationKeys = {
  all: ["applications"] as const,
  lists: () => [...applicationKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
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
  options?: { page?: number; pageSize?: number; facilityId?: string; ids?: string[] },
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
      queryFn: async () => {
        const result = await getApplicationsFn(request);
        if (!result.success) throw new Error(result.error);
        return result.data;
      },
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
    queryFn: async () => {
      const result = await getApplicationDeliveryOptionsFn(facilityId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000,
    enabled: options?.enabled,
  });
}

/**
 * Query hook for fetching a single application
 */
export function useApplication(id: string) {
  return useQuery({
    queryKey: applicationKeys.detail(id),
    queryFn: async () => {
      const result = await getApplicationByIdFn(id);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!id,
    staleTime: 30000,
  });
}

/**
 * Mutation hook for creating an application
 */
export function useCreateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ApplicationFormData) => createApplicationFn(data),
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
    mutationFn: (data: UpdateApplicationData) => updateApplicationFn(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: [...applicationKeys.all, "deliveryOptions"],
      });
      if (result.success && result.data) {
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
    mutationFn: (applicationId: string) =>
      deleteApplicationFn({ applicationId }),
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
