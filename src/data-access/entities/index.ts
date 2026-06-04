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
import {
  storageLocationTypes,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import { PURE_PRODUCT_BIN_FILTER } from "@/schemas/biochar-products";

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
  getBiocharProducts,
  getBiocharProductEntityById,
} from "./biochar-products";
import {
  getCreditBatchesEntity,
  getCreditBatchEntityById,
} from "./credit-batches";

/** Default page size for searchable entity-select queries. */
const DEFAULT_ENTITY_LIMIT = 50;

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
  const { entityType, search, filterBy, limit = DEFAULT_ENTITY_LIMIT } = params;

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
      // Validate every token against the allowed set before passing it down —
      // an unknown `filterBy.type` would otherwise be cast straight into a SQL
      // equality and silently match nothing (or, with future schema changes,
      // the wrong rows). Mirrors the productionRun status guard below.
      const rawType = filterBy?.type?.trim();
      let type: StorageLocationType | StorageLocationType[] | undefined;
      if (rawType) {
        const allowed = new Set<string>(storageLocationTypes);
        const validTypes = rawType
          .split(",")
          .map((t) => t.trim())
          .filter((t): t is StorageLocationType => allowed.has(t));
        // A type filter was requested but nothing matched the allowed set.
        // Treat it as a guaranteed no-match rather than dropping the filter —
        // widening to `undefined` here would return unrelated locations.
        if (validTypes.length === 0) return [];
        type = validTypes.length === 1 ? validTypes[0] : validTypes;
      }
      // Product-bin formulation filter: the sentinel means "pure-biochar product →
      // only unassigned bins"; a real id means "matching OR unassigned bins".
      const rawFormulation = filterBy?.formulationId?.trim();
      const pureProductOnly = rawFormulation === PURE_PRODUCT_BIN_FILTER;
      const formulationId =
        rawFormulation && rawFormulation !== PURE_PRODUCT_BIN_FILTER
          ? rawFormulation
          : undefined;
      return getStorageLocations({
        search,
        facilityId: filterBy?.facilityId,
        type,
        feedstockTypeId: filterBy?.feedstockTypeId,
        formulationId,
        pureProductOnly,
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
    case "biocharProduct":
      return getBiocharProducts({ search, facilityId: filterBy?.facilityId, limit });
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
    case "biocharProduct":
      return getBiocharProductEntityById(id);
    case "creditBatch":
      return getCreditBatchEntityById(id);
    default:
      return null;
  }
}
