"use client";

import { useQuery } from "@tanstack/react-query";
import { getFormulationByIdFn } from "@/fn/formulations";
import { getSupplierByIdFn } from "@/fn/suppliers";
import { getCustomerWithRelationsFn } from "@/fn/customers";
import { getFeedstockTypeByIdFn, canManageFeedstockTypesFn } from "@/fn/feedstock-types";
import { getReactorByIdFn } from "@/fn/reactors";
import { getOrderByIdFn } from "@/fn/orders";
import { getStorageLocationFn } from "@/fn/storage-locations";
import { getVehicleFn, getDriverFn, getOperatorFn } from "@/fn/fleet";
import { throwActionError } from "@/lib/stale-version";
import { formulationKeys } from "./use-formulations";
import { supplierKeys } from "./supplier-query-keys";
import { customerKeys } from "./customer-query-keys";
import { feedstockTypeKeys } from "./use-feedstock-types";
import { reactorKeys } from "./use-reactors";
import { orderKeys } from "./use-orders";
import { storageLocationKeys } from "./use-storage-locations";
import { fleetKeys } from "./use-fleet";

const readers = {
  formulation: (id: string) => getFormulationByIdFn(id),
  supplier: (id: string) => getSupplierByIdFn(id),
  customer: (id: string) => getCustomerWithRelationsFn(id),
  feedstockType: (id: string) => getFeedstockTypeByIdFn(id),
  reactor: (id: string) => getReactorByIdFn(id),
  order: (id: string) => getOrderByIdFn(id),
  storageLocation: (id: string) => getStorageLocationFn({ storageLocationId: id }),
  vehicle: (id: string) => getVehicleFn({ vehicleId: id }),
  driver: (id: string) => getDriverFn({ driverId: id }),
  operator: (id: string) => getOperatorFn({ operatorId: id }),
};

export type EditableEntityType = keyof typeof readers;
type ResultData<T> = T extends { success: true; data: infer R } ? R : never;
export type EntityEditRecords = {
  [K in EditableEntityType]: ResultData<Awaited<ReturnType<(typeof readers)[K]>>>;
};

const keys = {
  formulation: (id: string) => formulationKeys.detail(id),
  supplier: (id: string) => supplierKeys.detail(id),
  customer: (id: string) => customerKeys.detailWithRelations(id),
  feedstockType: (id: string) => feedstockTypeKeys.detail(id),
  reactor: (id: string) => reactorKeys.detail(id),
  order: (id: string) => orderKeys.detail(id),
  storageLocation: (id: string) => storageLocationKeys.detailWithFacility(id),
  vehicle: (id: string) => fleetKeys.detail("vehicle", id),
  driver: (id: string) => fleetKeys.detail("driver", id),
  operator: (id: string) => fleetKeys.detail("operator", id),
};

export function isEditableEntityType(type: string): type is EditableEntityType {
  return Object.hasOwn(readers, type);
}

/** Each dialog session mounts a new observer and waits for its opening read. */
export function useEntityEditRecord<K extends EditableEntityType>(type: K, id: string) {
  return useQuery({
    queryKey: keys[type](id),
    queryFn: async (): Promise<EntityEditRecords[K]> => {
      const result = await readers[type](id);
      if (!result.success) throwActionError(result);
      return result.data as EntityEditRecords[K];
    },
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
