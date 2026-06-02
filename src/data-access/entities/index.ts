/**
 * Entity Data Access Layer
 * Database queries for searchable entity selection.
 *
 * Public API: getEntities / getEntityById. Both authenticate, then dispatch on
 * EntityType to a per-entity module in this folder. The per-entity query
 * helpers are intentionally not re-exported — callers select through the
 * dispatcher so the auth gate is never bypassed.
 */

import { requireAuth } from "../utils";
import { productionRunStatus } from "@/db/schema/common";
import type {
  EntityOption,
  EntityType,
} from "@/components/forms/entity-select/types";
import type { StorageLocationType } from "@/schemas/storage-locations";

import { getFacilities, getFacilityById } from "./facilities";
import { getReactors, getReactorById } from "./reactors";
import { getSuppliers, getSupplierById } from "./suppliers";
import { getCustomers, getCustomerById } from "./customers";
import { getDrivers, getDriverById } from "./drivers";
import { getOperators, getOperatorById } from "./operators";
import { getStorageLocations, getStorageLocationById } from "./storage-locations";
import { getVehicles, getVehicleById } from "./vehicles";
import { getFeedstockTypes, getFeedstockTypeById } from "./feedstock-types";
import { getFeedstocks, getFeedstockById } from "./feedstocks";
import {
  getProductionRunsEntity,
  getProductionRunEntityById,
} from "./production-runs";
import {
  getApplicationsEntity,
  getApplicationEntityById,
} from "./applications";
import {
  getFormulationsEntity,
  getFormulationEntityById,
} from "./formulations";
import {
  getCreditBatchesEntity,
  getCreditBatchEntityById,
} from "./credit-batches";

interface GetEntitiesParams {
  entityType: EntityType;
  search?: string;
  filterBy?: Record<string, string>;
  limit?: number;
}

export async function getEntities(
  userId: string,
  params: GetEntitiesParams
): Promise<EntityOption[]> {
  requireAuth(userId);
  const { entityType, search, filterBy, limit = 50 } = params;

  switch (entityType) {
    case "facility":
      return getFacilities({ search, limit });
    case "reactor":
      return getReactors({ search, facilityId: filterBy?.facilityId, limit });
    case "supplier":
      return getSuppliers({ search, limit });
    case "customer":
      return getCustomers({ search, limit });
    case "driver":
      return getDrivers({ search, limit });
    case "operator":
      return getOperators({ search, limit });
    case "storageLocation": {
      const typeFilter = filterBy?.type;
      const types = typeFilter?.includes(",")
        ? typeFilter.split(",").map((t) => t.trim()) as StorageLocationType[]
        : typeFilter as StorageLocationType | undefined;
      return getStorageLocations({
        search,
        facilityId: filterBy?.facilityId,
        type: types,
        feedstockTypeId: filterBy?.feedstockTypeId,
        limit,
      });
    }
    case "vehicle":
      return getVehicles({ search, limit });
    case "feedstockType":
      return getFeedstockTypes({ search, limit });
    case "feedstock":
      return getFeedstocks({ search, facilityId: filterBy?.facilityId, limit });
    case "productionRun": {
      const validStatuses = productionRunStatus.enumValues as readonly string[];
      const status = filterBy?.status && validStatuses.includes(filterBy.status)
        ? (filterBy.status as (typeof productionRunStatus.enumValues)[number])
        : undefined;
      return getProductionRunsEntity({
        search,
        facilityId: filterBy?.facilityId,
        status,
        limit,
      });
    }
    case "application":
      return getApplicationsEntity({ search, facilityId: filterBy?.facilityId, limit });
    case "formulation":
      return getFormulationsEntity({ search, limit });
    case "creditBatch":
      return getCreditBatchesEntity({ search, facilityId: filterBy?.facilityId, limit });
    default:
      return [];
  }
}

export async function getEntityById(
  userId: string,
  entityType: EntityType,
  id: string
): Promise<EntityOption | null> {
  requireAuth(userId);
  switch (entityType) {
    case "facility":
      return getFacilityById(id);
    case "reactor":
      return getReactorById(id);
    case "supplier":
      return getSupplierById(id);
    case "customer":
      return getCustomerById(id);
    case "driver":
      return getDriverById(id);
    case "operator":
      return getOperatorById(id);
    case "storageLocation":
      return getStorageLocationById(id);
    case "vehicle":
      return getVehicleById(id);
    case "feedstockType":
      return getFeedstockTypeById(id);
    case "feedstock":
      return getFeedstockById(id);
    case "productionRun":
      return getProductionRunEntityById(id);
    case "application":
      return getApplicationEntityById(id);
    case "formulation":
      return getFormulationEntityById(id);
    case "creditBatch":
      return getCreditBatchEntityById(id);
    default:
      return null;
  }
}
