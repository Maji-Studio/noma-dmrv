"use client";

import { useQuery, type SkipToken, type UseQueryOptions } from "@tanstack/react-query";
import { getFeedstockTypeByIdFn, canManageFeedstockTypesFn } from "@/fn/feedstock-types";
import { getReactorByIdFn } from "@/fn/reactors";
import { getOrderByIdFn } from "@/fn/orders";
import { getStorageLocationFn } from "@/fn/storage-locations";
import { getVehicleFn, getDriverFn, getOperatorFn } from "@/fn/fleet";
import { throwActionError } from "@/lib/stale-version";
import { formulationQueryOptions } from "./use-formulations";
import { supplierQueryOptions } from "./use-suppliers";
import { customerWithRelationsQueryOptions } from "./use-customers";
import { feedstockTypeKeys } from "./use-feedstock-types";
import { reactorKeys } from "./use-reactors";
import { orderKeys } from "./use-orders";
import { storageLocationKeys } from "./use-storage-locations";
import { fleetKeys } from "./use-fleet";

const readers = {
  feedstockType: (id: string) => getFeedstockTypeByIdFn(id),
  reactor: (id: string) => getReactorByIdFn(id),
  order: (id: string) => getOrderByIdFn(id),
  storageLocation: (id: string) => getStorageLocationFn({ storageLocationId: id }),
  vehicle: (id: string) => getVehicleFn({ vehicleId: id }),
  driver: (id: string) => getDriverFn({ driverId: id }),
  operator: (id: string) => getOperatorFn({ operatorId: id }),
};

const sharedQueries = {
  formulation: (id: string) => formulationQueryOptions(id),
  supplier: (id: string) => supplierQueryOptions(id),
  customer: (id: string) => customerWithRelationsQueryOptions(id),
};

export type EditableEntityType = keyof typeof readers | keyof typeof sharedQueries;
type ResultData<T> = T extends { success: true; data: infer R } ? R : never;
type QueryData<T extends { queryFn?: unknown }> =
  Exclude<T["queryFn"], SkipToken | undefined> extends (...args: never[]) => infer R ? Awaited<R> : never;
// Shared record shapes come from the same query options the normal hooks use.
export type EntityEditRecords = {
  [K in keyof typeof readers]: ResultData<Awaited<ReturnType<(typeof readers)[K]>>>;
} & {
  [K in keyof typeof sharedQueries]: QueryData<ReturnType<(typeof sharedQueries)[K]>>;
};

const keys = {
  feedstockType: (id: string) => feedstockTypeKeys.detail(id),
  reactor: (id: string) => reactorKeys.detail(id),
  order: (id: string) => orderKeys.detail(id),
  storageLocation: (id: string) => storageLocationKeys.detailWithFacility(id),
  vehicle: (id: string) => fleetKeys.detail("vehicle", id),
  driver: (id: string) => fleetKeys.detail("driver", id),
  operator: (id: string) => fleetKeys.detail("operator", id),
};

export function isEditableEntityType(type: string): type is EditableEntityType {
  return Object.hasOwn(sharedQueries, type) || Object.hasOwn(readers, type);
}

function editRecordQueryOptions(type: EditableEntityType, id: string) {
  if (type === "formulation" || type === "supplier" || type === "customer") {
    return sharedQueries[type](id);
  }
  return {
    queryKey: keys[type](id),
    queryFn: async () => {
      const result = await readers[type](id);
      if (!result.success) throwActionError(result);
      return result.data;
    },
  };
}

/** Each dialog session mounts a new observer and waits for its opening read. */
export function useEntityEditRecord<K extends EditableEntityType>(type: K, id: string) {
  // The entity type selects the matching record shape from the heterogeneous map.
  const options = editRecordQueryOptions(type, id) as UseQueryOptions<EntityEditRecords[K]>;
  return useQuery({
    ...options,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
}

export function useCanManageFeedstockTypes() {
  return useQuery({
    queryKey: feedstockTypeKeys.canManage(),
    queryFn: async () => {
      const result = await canManageFeedstockTypesFn();
      if (!result.success) throwActionError(result);
      return result.data;
    },
  }).data === true;
}
