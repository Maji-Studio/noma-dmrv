import { deliveryKeys } from "./use-deliveries";
import { transportLegKeys } from "./use-transport-legs";
import { invalidateCertificationReadiness } from "./use-certification";
/**
 * Customers React Query Hooks
 * Client-side state management for customer and customer location operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { orderKeys } from "./use-orders";
import { activityKeys } from "./activity-query-keys";
import {
  keepPreviousData,
  queryOptions,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Customer, CustomerLocation } from "@/db/schema";
import { seedEntityCache } from "@/components/forms/entity-select/cache-utils";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type {
  CustomerFilterData,
  CreateCustomerWithLocationsData,
  UpdateCustomerData,
  CreateCustomerLocationData,
  UpdateCustomerLocationData,
} from "@/schemas/customers";
import type {
  PaginatedCustomers,
  CustomerWithRelations,
  CreatedCustomerWithLocations,
} from "@/data-access/customers";
import type { CascadePreview } from "@/lib/domain-errors";
import {
  getCustomersFn,
  getCustomerWithRelationsFn,
  getCustomerLocationsFn,
  createCustomerWithLocationsFn,
  updateCustomerFn,
  deleteCustomerFn,
  previewDeleteCustomerFn,
  archiveCustomerLocationFn,
  restoreCustomerLocationFn,
  archiveCustomerFn,
  restoreCustomerFn,
  createCustomerLocationFn,
  updateCustomerLocationFn,
  deleteCustomerLocationFn,
} from "@/fn/customers";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";
import { patchArrayListCacheByExactKeyWithSavedRow, patchListCachesWithSavedRow } from "./list-cache-utils";
import { throwActionError, StaleVersionError } from "@/lib/stale-version";
import { throwIfCascadeChanged } from "@/lib/cascade-changed";
import { customerKeys } from "./customer-query-keys";
import { entityKeys, invalidateEntityTypeQueries } from "./entity-query-keys";

export { customerKeys } from "./customer-query-keys";

const CUSTOMER_DETAIL_STALE_TIME_MS = 30_000;

const customerLocationKeys = {
  all: ["customerLocations"] as const,
  detail: (id: string) => [...customerLocationKeys.all, "detail", id] as const,
};

const CUSTOMER_ENTITY_TYPE = "customer" as const;
const CUSTOMER_LOCATION_ENTITY_TYPE = "customerLocation" as const;

/**
 * Seed the customer detail cache and the EntitySelect caches so the order form
 * and order list customer pickers see a newly created customer immediately.
 */
function seedCreatedCustomerCaches(
  queryClient: QueryClient,
  customer: Customer,
) {
  const option: EntityOption = {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    subtitle: customer.cropType ?? undefined,
  };

  queryClient.setQueryData(customerKeys.detail(customer.id), customer);
  seedEntityCache(queryClient, CUSTOMER_ENTITY_TYPE, option);
}


// ============================================
// Customer Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of customers with filtering
 */
export function useCustomers(filters?: Partial<CustomerFilterData>) {
  return useQuery({
    queryKey: customerKeys.list(filters),
    queryFn: async () => {
      const result = await getCustomersFn(filters);
      if (!result.success) {
        throwActionError(result);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
    // A search or page change creates a new query key. Without this the list
    // blanks to skeletons for the round trip, which unmounts an open row menu
    // mid-click (issue #798). Keeping the previous page means the control the
    // operator just used stays put until the new page is in.
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch a customer with all its relations
 */
export function customerWithRelationsQueryOptions(customerId: string) {
  return queryOptions({
    queryKey: customerKeys.detailWithRelations(customerId),
    queryFn: async () => {
      const result = await getCustomerWithRelationsFn(customerId);
      if (!result.success) {
        throwActionError(result);
      }
      return result.data;
    },
    enabled: !!customerId,
    staleTime: CUSTOMER_DETAIL_STALE_TIME_MS,
  });
}

export function useCustomerWithRelations(customerId: string, enabled = true) {
  return useQuery({
    ...customerWithRelationsQueryOptions(customerId),
    enabled: enabled && !!customerId,
  });
}

/**
 * Hook to fetch locations for a specific customer
 */
export function useCustomerLocations(customerId: string, enabled = true) {
  return useQuery({
    queryKey: customerKeys.locations(customerId),
    queryFn: async () => {
      const result = await getCustomerLocationsFn(customerId);
      if (!result.success) {
        throwActionError(result);
      }
      return result.data;
    },
    enabled: enabled && !!customerId,
    staleTime: 30000,
  });
}

/**
 * Dry run of a customer delete: the orders without deliveries that would go
 * with it, and the fingerprint the delete must send back. Never cached, so the
 * confirmation always reads the orders as they are now.
 */
export function useCustomerDeletePreview(customer: { id: string; version: number } | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: customerKeys.deletePreview(customer?.id ?? "", customer?.version ?? 0),
    queryFn: async () => {
      const result = await previewDeleteCustomerFn({ customerId: customer!.id, expectedVersion: customer!.version });
      if (!result.success) {
        try {
          throwActionError(result);
        } catch (error) {
          // A stale row refreshes the list, as a stale delete does, so reopening the dialog reads the current version.
          if (error instanceof StaleVersionError) void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
          throw error;
        }
      }
      return result.data;
    },
    enabled: !!customer,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // Each run is a locked dry-run delete; refetching on focus would repeat it for nothing.
    refetchOnWindowFocus: false,
  });
}

// ============================================
// Customer Mutation Hooks
// ============================================

/**
 * Hook to create a customer together with the locations captured on its create
 * form. One server round trip, one transaction: nothing is saved unless every
 * location is.
 */
export function useCreateCustomerWithLocations(
  callbacks?: MutationCallbacks<
    CreatedCustomerWithLocations,
    CreateCustomerWithLocationsData
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCustomerWithLocationsData) => {
      const result = await createCustomerWithLocationsFn(data);
      if (!result.success) {
        throwActionError(result);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: customerKeys.locations(data.customer.id),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(data.customer.id),
      });

      seedCreatedCustomerCaches(queryClient, data.customer);
      for (const location of data.locations) {
        queryClient.setQueryData(
          customerLocationKeys.detail(location.id),
          location,
        );
      }
      invalidateEntityTypeQueries(queryClient, CUSTOMER_LOCATION_ENTITY_TYPE);

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to update an existing customer
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateCustomer(
  callbacks?: MutationCallbacks<Customer, UpdateCustomerData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateCustomerData) => {
      const result = await updateCustomerFn(data);
      // Keeps an expected-version refusal typed so the open edit form can show
      // it and hold on to the operator's draft (issue #768).
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onMutate: async (variables) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(variables);
        return;
      }

      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      await queryClient.cancelQueries({
        queryKey: customerKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousCustomer = queryClient.getQueryData<Customer>(
        customerKeys.detail(variables.customerId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedCustomers>({
        queryKey: customerKeys.lists(),
      });

      // Optimistically update the customer detail cache
      if (previousCustomer) {
        queryClient.setQueryData<Customer>(
          customerKeys.detail(variables.customerId),
          (old) =>
            old
              ? {
                  ...old,
                  ...variables,
                  updatedAt: new Date(),
                }
              : old
        );
      }

      // Optimistically update customer in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedCustomers>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.customerId
                ? // No client-invented `updatedAt`: the row keeps the version it
                  // was read on, so an edit sheet opened off this cache saves
                  // against a version the server really wrote (#768).
                  ({ ...item, ...variables } as CustomerWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousCustomer, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(customerKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(data.id),
      });
      patchListCachesWithSavedRow<CustomerWithRelations>(
        queryClient,
        customerKeys.lists(),
        data,
      );
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      invalidateEntityTypeQueries(queryClient, CUSTOMER_ENTITY_TYPE);
      invalidateEntityTypeQueries(queryClient, "order");

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousCustomer, previousLists } = context as {
          previousCustomer?: Customer;
          previousLists?: [readonly unknown[], PaginatedCustomers | undefined][];
        };

        if (previousCustomer) {
          queryClient.setQueryData(
            customerKeys.detail(variables.customerId),
            previousCustomer
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      if (error instanceof StaleVersionError) {
        void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      }
      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      // Refetch to ensure cache consistency after mutation settles
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
        exact: true,
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a customer
 * Supports optimistic updates for immediate UI feedback
 */
type DeleteCustomerVariables = { customerId: string; expectedVersion: number; cascadeFingerprint?: string };
/** What a delete answers with, after the action's JSON round trip. */
export interface DeletedCustomerResult {
  cascade: CascadePreview;
  warnings: string[];
}

export function useDeleteCustomer(
  callbacks?: MutationCallbacks<DeletedCustomerResult, DeleteCustomerVariables>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (variables: DeleteCustomerVariables) => {
      const result = await deleteCustomerFn(variables);
      if (!result.success) {
        // A changed order set carries the fresh list so the dialog can show it.
        throwIfCascadeChanged(result);
        throwActionError(result);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      const customerId = variables.customerId;
      if (!optimistic) {
        await callbacks?.onMutate?.(variables);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: customerKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousCustomer = queryClient.getQueryData<Customer>(
        customerKeys.detail(customerId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedCustomers>({
        queryKey: customerKeys.lists(),
      });

      // Optimistically remove customer from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedCustomers>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== customerId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousCustomer, previousLists };
    },
    onSuccess: async (data, variables) => {
      const customerId = variables.customerId;
      // The orders that went with the customer leave the order lists and pickers.
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      invalidateEntityTypeQueries(queryClient, "order");
      // Remove specific customer from cache
      queryClient.removeQueries({ queryKey: customerKeys.detail(customerId) });
      queryClient.removeQueries({
        queryKey: customerKeys.detailWithRelations(customerId),
      });
      queryClient.removeQueries({
        queryKey: customerKeys.locations(customerId),
      });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      // Drop the deleted customer from the pickers
      queryClient.removeQueries({
        queryKey: entityKeys.detail(CUSTOMER_ENTITY_TYPE, customerId),
      });
      invalidateEntityTypeQueries(queryClient, CUSTOMER_ENTITY_TYPE);

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      if (error instanceof StaleVersionError) void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      const customerId = variables.customerId;
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousCustomer, previousLists } = context as {
          previousCustomer?: Customer;
          previousLists?: [readonly unknown[], PaginatedCustomers | undefined][];
        };

        if (previousCustomer) {
          queryClient.setQueryData(
            customerKeys.detail(customerId),
            previousCustomer
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
            // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

// ============================================
// Customer Location Query Hooks
// ============================================

// ============================================
// Customer Location Mutation Hooks
// ============================================

type CustomerVersionVariables = { customerId: string; expectedVersion: number };

/** Archive and restore share one shape: a version-checked flip of `archivedAt`. */
function useCustomerLifecycle(
  action: (variables: CustomerVersionVariables) => ReturnType<typeof archiveCustomerFn>,
  callbacks?: MutationCallbacks<Customer, CustomerVersionVariables>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: CustomerVersionVariables) => {
      const result = await action(variables);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: async (data, variables) => {
      // Merge the saved row (with its new version) into every list and detail
      // cache before the refetch, so an open sheet or order form never reads
      // the archive state or version from before this change.
      patchListCachesWithSavedRow<CustomerWithRelations>(queryClient, customerKeys.lists(), data);
      queryClient.setQueryData<Customer>(customerKeys.detail(data.id), (old) => (old ? { ...old, ...data } : data));
      queryClient.setQueryData<Customer>(customerKeys.detailWithRelations(data.id), (old) => (old ? { ...old, ...data } : old));
      invalidateEntityTypeQueries(queryClient, CUSTOMER_ENTITY_TYPE);
      invalidateEntityTypeQueries(queryClient, "order");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: customerKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: customerKeys.detailWithRelations(data.id) }),
      ]);
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      if (error instanceof StaleVersionError) void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/** Hook to archive a customer: pickers hide it, stored orders keep it. */
export function useArchiveCustomer(callbacks?: MutationCallbacks<Customer, CustomerVersionVariables>) {
  return useCustomerLifecycle(archiveCustomerFn, callbacks);
}

/** Hook to restore an archived customer. */
export function useRestoreCustomer(callbacks?: MutationCallbacks<Customer, CustomerVersionVariables>) {
  return useCustomerLifecycle(restoreCustomerFn, callbacks);
}

/**
 * Hook to create a new customer location
 */
export function useCreateCustomerLocation(
  callbacks?: MutationCallbacks<CustomerLocation, CreateCustomerLocationData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCustomerLocationData) => {
      const result = await createCustomerLocationFn(data);
      if (!result.success) {
        throwActionError(result);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate customer locations list
      queryClient.invalidateQueries({
        queryKey: customerKeys.locations(variables.customerId),
      });
      // Invalidate customer detail with relations
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(variables.customerId),
      });
      // Invalidate customer lists (location count changed)
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });

      // Pre-populate the detail cache
      queryClient.setQueryData(customerLocationKeys.detail(data.id), data);
      invalidateEntityTypeQueries(queryClient, CUSTOMER_LOCATION_ENTITY_TYPE);

      queryClient.invalidateQueries({ queryKey: orderKeys.selects() });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deliveryKeys.all }),
        queryClient.invalidateQueries({ queryKey: transportLegKeys.all }),
        invalidateCertificationReadiness(queryClient, { creditBatchPreviews: true }),
      ]);
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to update a customer location
 */
export function useUpdateCustomerLocation(
  callbacks?: MutationCallbacks<CustomerLocation, UpdateCustomerLocationData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateCustomerLocationData) => {
      const result = await updateCustomerLocationFn(data);
      // Keeps an expected-version refusal typed so the open edit dialog can
      // show it and hold on to the operator's draft (issue #768).
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      patchArrayListCacheByExactKeyWithSavedRow<CustomerLocation>(queryClient, customerKeys.locations(data.customerId), data);
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      // Update cache with actual server data
      queryClient.setQueryData(customerLocationKeys.detail(data.id), data);
      invalidateEntityTypeQueries(queryClient, CUSTOMER_LOCATION_ENTITY_TYPE);

      // Invalidate customer locations list
      queryClient.invalidateQueries({
        queryKey: customerKeys.locations(data.customerId),
      });
      // Invalidate customer detail with relations
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(data.customerId),
      });

      queryClient.invalidateQueries({ queryKey: orderKeys.selects() });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deliveryKeys.all }),
        queryClient.invalidateQueries({ queryKey: transportLegKeys.all }),
        invalidateCertificationReadiness(queryClient, { creditBatchPreviews: true }),
      ]);
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      if (error instanceof StaleVersionError) {
        void queryClient.invalidateQueries({ queryKey: customerKeys.all });
        void queryClient.invalidateQueries({ queryKey: customerLocationKeys.all });
      }
      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a customer location
 */
export function useDeleteCustomerLocation(
  customerId: string,
  callbacks?: MutationCallbacks<{ warnings: string[] } | undefined, { locationId: string; expectedVersion: number }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { locationId: string; expectedVersion: number }) => {
      const result = await deleteCustomerLocationFn(variables);
      if (!result.success) {
        throwActionError(result);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      const locationId = variables.locationId;
      // Remove from cache
      queryClient.removeQueries({
        queryKey: customerLocationKeys.detail(locationId),
      });
      queryClient.removeQueries({ queryKey: entityKeys.detail(CUSTOMER_LOCATION_ENTITY_TYPE, locationId) });
      invalidateEntityTypeQueries(queryClient, CUSTOMER_LOCATION_ENTITY_TYPE);
      // Invalidate customer locations list
      queryClient.invalidateQueries({
        queryKey: customerKeys.locations(customerId),
      });
      // Invalidate customer detail with relations
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(customerId),
      });
      // Invalidate customer lists (location count changed)
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });

      queryClient.invalidateQueries({ queryKey: orderKeys.selects() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      if (error instanceof StaleVersionError) void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

type CustomerLocationVersionVariables = { locationId: string; expectedVersion: number };
type CustomerLocationLifecycleResult = CustomerLocation & { warnings: string[] };

/**
 * Archive and restore share one shape: a version-checked flip of `archivedAt`
 * that can also move the default, so the siblings are refetched with it.
 */
function useCustomerLocationLifecycle(
  customerId: string,
  action: (variables: CustomerLocationVersionVariables) => ReturnType<typeof archiveCustomerLocationFn>,
  callbacks?: MutationCallbacks<CustomerLocationLifecycleResult, CustomerLocationVersionVariables>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: CustomerLocationVersionVariables) => {
      const result = await action(variables);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: async (data, variables) => {
      // Merge the saved row (with its new version) into the locations cache
      // before the refetch, so an open sheet never saves against the archive
      // state or version from before this change.
      const saved: Partial<CustomerLocationLifecycleResult> = { ...data };
      delete saved.warnings;
      patchArrayListCacheByExactKeyWithSavedRow<CustomerLocation>(queryClient, customerKeys.locations(customerId), { ...saved, id: data.id });
      queryClient.setQueryData(customerLocationKeys.detail(data.id), saved);
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      invalidateEntityTypeQueries(queryClient, CUSTOMER_LOCATION_ENTITY_TYPE);
      queryClient.invalidateQueries({ queryKey: orderKeys.selects() });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: customerKeys.locations(customerId) }),
        queryClient.invalidateQueries({ queryKey: customerKeys.detailWithRelations(customerId) }),
        // The list's location count covers active locations only.
        queryClient.invalidateQueries({ queryKey: customerKeys.lists() }),
      ]);
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      if (error instanceof StaleVersionError) void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/** Hook to archive a customer location: pickers hide it, stored orders keep it. */
export function useArchiveCustomerLocation(
  customerId: string,
  callbacks?: MutationCallbacks<CustomerLocationLifecycleResult, CustomerLocationVersionVariables>,
) {
  return useCustomerLocationLifecycle(customerId, archiveCustomerLocationFn, callbacks);
}

/** Hook to restore an archived customer location. */
export function useRestoreCustomerLocation(
  customerId: string,
  callbacks?: MutationCallbacks<CustomerLocationLifecycleResult, CustomerLocationVersionVariables>,
) {
  return useCustomerLocationLifecycle(customerId, restoreCustomerLocationFn, callbacks);
}

// ============================================
// Prefetch Utilities
// ============================================

// ============================================
// Cache Invalidation Utilities
// ============================================
