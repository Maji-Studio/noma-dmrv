/**
 * Vehicles, drivers and operators: settings lists and edit and delete mutations.
 *
 * Every write refreshes the fleet lists, the entity-select caches for its kind
 * and the records that display it. A vehicle edit can also refresh the derived
 * feedstock transport legs, so it refreshes those and certification too.
 */
"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { Driver, Operator, Vehicle } from "@/db/schema";
import {
  deleteDriverFn,
  deleteOperatorFn,
  deleteVehicleFn,
  listDriversFn,
  listOperatorsFn,
  listVehiclesFn,
  updateDriverFn,
  updateOperatorFn,
  updateVehicleFn,
} from "@/fn/fleet";
import type { FleetKind } from "@/lib/fleet/messages";
import { StaleVersionError, throwActionError } from "@/lib/stale-version";
import type {
  DeleteDriverInput,
  DeleteOperatorInput,
  DeleteVehicleInput,
  UpdateDriverInput,
  UpdateOperatorInput,
  UpdateVehicleInput,
} from "@/schemas/fleet";
import type { ActionResult } from "@/types/actions";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { formatVehicleType } from "@/schemas/vehicles";
import { certificationKeys } from "./use-certification";
import { chainOfCustodyKeys } from "./use-chain-of-custody";
import { deliveryKeys } from "./use-deliveries";
import { entityKeys, invalidateEntityTypeQueries } from "./entity-query-keys";
import { patchArrayListCacheByExactKeyWithSavedRow } from "./list-cache-utils";
import { feedstockKeys } from "./use-feedstocks";
import { productionIncidentKeys } from "./use-production-incidents";
import { productionRunKeys } from "./use-production-runs";
import { productionSampleKeys } from "./use-production-samples";
import { transportLegKeys } from "./use-transport-legs";

export interface FleetRecords {
  vehicle: Vehicle;
  driver: Driver;
  operator: Operator;
}

export const fleetKeys = {
  all: ["fleet"] as const,
  kind: (kind: FleetKind) => [...fleetKeys.all, kind] as const,
  list: (kind: FleetKind) => [...fleetKeys.kind(kind), "list"] as const,
  detail: (kind: FleetKind, id: string) => [...fleetKeys.kind(kind), "detail", id] as const,
};

/** Records whose screens show this kind, refreshed after an edit or delete. */
const DEPENDENT_KEYS: Record<FleetKind, readonly QueryKey[]> = {
  vehicle: [
    feedstockKeys.all,
    deliveryKeys.all,
    transportLegKeys.all,
    chainOfCustodyKeys.all,
    certificationKeys.all,
  ],
  driver: [deliveryKeys.all],
  operator: [productionRunKeys.all, productionIncidentKeys.all, productionSampleKeys.all],
};

function invalidateFleetKind(queryClient: QueryClient, kind: FleetKind) {
  void queryClient.invalidateQueries({ queryKey: fleetKeys.kind(kind) });
  invalidateEntityTypeQueries(queryClient, kind);
  for (const queryKey of DEPENDENT_KEYS[kind]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** The picker option for a saved record, matching `data-access/entities`. */
const TO_OPTION = {
  vehicle: (vehicle: Vehicle): EntityOption => ({
    id: vehicle.id, code: vehicle.code, name: vehicle.name, subtitle: formatVehicleType(vehicle.vehicleType),
  }),
  driver: (driver: Driver): EntityOption => ({
    id: driver.id, code: driver.code, name: driver.name, subtitle: driver.licenseNumber ?? undefined,
  }),
  operator: (operator: Operator): EntityOption => ({
    id: operator.id, code: operator.name, name: operator.name, subtitle: operator.credentials ?? undefined,
  }),
} satisfies { [K in FleetKind]: (record: FleetRecords[K]) => EntityOption };

/**
 * Install a saved record, with the version the server wrote, in the settings
 * list (which hands rows to Edit and Delete), its detail cache and every open
 * picker, before the invalidation refetches them.
 */
export function applySavedFleetRecord<K extends FleetKind>(
  queryClient: QueryClient,
  kind: K,
  record: FleetRecords[K],
) {
  const toOption = TO_OPTION[kind] as (saved: FleetRecords[K]) => EntityOption;
  patchArrayListCacheByExactKeyWithSavedRow<FleetRecords[K]>(queryClient, fleetKeys.list(kind), record);
  queryClient.setQueryData(entityKeys.detail(kind, record.id), toOption(record));
  queryClient.setQueryData(fleetKeys.detail(kind, record.id), record);
}

/** Drop a deleted record from the settings list before the refetch. */
export function removeDeletedFleetRecord(queryClient: QueryClient, kind: FleetKind, id: string) {
  queryClient.setQueryData<{ id: string }[]>(fleetKeys.list(kind), (old) =>
    old?.filter((record) => record.id !== id),
  );
}

async function unwrap<T>(pending: Promise<ActionResult<T>>): Promise<T> {
  const result = await pending;
  if (!result.success) throwActionError(result);
  return result.data;
}

// ============================================
// Reads
// ============================================

const LIST_FNS = {
  vehicle: listVehiclesFn,
  driver: listDriversFn,
  operator: listOperatorsFn,
} satisfies { [K in FleetKind]: () => Promise<ActionResult<FleetRecords[K][]>> };

export function useFleetList<K extends FleetKind>(kind: K) {
  return useQuery({
    queryKey: fleetKeys.list(kind),
    queryFn: () => unwrap(LIST_FNS[kind]() as Promise<ActionResult<FleetRecords[K][]>>),
  });
}

// ============================================
// Mutations
// ============================================

function useFleetMutation<K extends FleetKind, TInput, TData>(
  kind: K,
  mutate: (input: TInput) => Promise<ActionResult<TData>>,
  onSaved?: (queryClient: QueryClient, data: TData) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => unwrap(mutate(input)),
    onSuccess: (data) => {
      onSaved?.(queryClient, data);
      invalidateFleetKind(queryClient, kind);
    },
    onError: (error) => {
      if (error instanceof StaleVersionError) invalidateFleetKind(queryClient, kind);
    },
  });
}

export function useUpdateVehicle() {
  return useFleetMutation("vehicle", (input: UpdateVehicleInput) => updateVehicleFn(input), (client, saved) =>
    applySavedFleetRecord(client, "vehicle", saved));
}

export function useDeleteVehicle() {
  return useFleetMutation("vehicle", (input: DeleteVehicleInput) => deleteVehicleFn(input), (client, deleted) =>
    removeDeletedFleetRecord(client, "vehicle", deleted.id));
}

export function useUpdateDriver() {
  return useFleetMutation("driver", (input: UpdateDriverInput) => updateDriverFn(input), (client, saved) =>
    applySavedFleetRecord(client, "driver", saved));
}

export function useDeleteDriver() {
  return useFleetMutation("driver", (input: DeleteDriverInput) => deleteDriverFn(input), (client, deleted) =>
    removeDeletedFleetRecord(client, "driver", deleted.id));
}

export function useUpdateOperator() {
  return useFleetMutation("operator", (input: UpdateOperatorInput) => updateOperatorFn(input), (client, saved) =>
    applySavedFleetRecord(client, "operator", saved));
}

export function useDeleteOperator() {
  return useFleetMutation("operator", (input: DeleteOperatorInput) => deleteOperatorFn(input), (client, deleted) =>
    removeDeletedFleetRecord(client, "operator", deleted.id));
}

/** Refresh after a quick-add create from the settings list. */
export function useInvalidateFleetKind() {
  const queryClient = useQueryClient();
  return (kind: FleetKind) => invalidateFleetKind(queryClient, kind);
}
