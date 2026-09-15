/**
 * Entity Data Access Layer
 * Database queries for searchable entity selection.
 *
 * Public API: getEntities / getEntityById. Both authenticate, then dispatch on
 * EntityType to a per-entity module in this folder. The per-entity query
 * helpers are intentionally not re-exported — callers select through the
 * dispatcher so the auth gate is never bypassed.
 */

import type {
  EntityOption,
  EntityType,
} from "@/components/forms/entity-select/types";
import { productionRunStatus } from "@/db/schema/common";
import type { OrgContext } from "@/lib/auth/server";
import { PURE_PRODUCT_BIN_FILTER } from "@/schemas/biochar-products";
import {
  storageLocationTypes,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import { requireOrgScope } from "../utils";

import {
  getApplicationEntityById,
  getApplicationsEntity,
} from "./applications";
import {
  getBiocharProductEntityById,
  getBiocharProducts,
} from "./biochar-products";
import {
  getCreditBatchEntityById,
  getCreditBatchesEntity,
} from "./credit-batches";
import { getCustomerById, getCustomers } from "./customers";
import { getDriverById, getDrivers } from "./drivers";
import { getFacilities, getFacilityById } from "./facilities";
import { getFeedstockTypeById, getFeedstockTypes } from "./feedstock-types";
import { getFeedstockById, getFeedstocks } from "./feedstocks";
import {
  getFormulationEntityById,
  getFormulationsEntity,
} from "./formulations";
import { getOperatorById, getOperators } from "./operators";
import { getOrderEntityById, getOrdersEntity } from "./orders";
import {
  getProductionRunEntityById,
  getProductionRunsEntity,
} from "./production-runs";
import { getReactorById, getReactors } from "./reactors";
import { getStorageLocationById, getStorageLocations } from "./storage-locations";
import { getSupplierById, getSuppliers } from "./suppliers";
import { getVehicleById, getVehicles } from "./vehicles";

/** Default page size for searchable entity-select queries. */
const DEFAULT_ENTITY_LIMIT = 50;

interface GetEntitiesParams {
  entityType: EntityType;
  search?: string;
  filterBy?: Record<string, string>;
  limit?: number;
}

export async function getEntities(
  ctx: OrgContext,
  params: GetEntitiesParams
): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { entityType, search, filterBy, limit = DEFAULT_ENTITY_LIMIT } = params;

  switch (entityType) {
    case "facility":
      return getFacilities(ctx, { search, limit });
    case "reactor":
      return getReactors(ctx, { search, facilityId: filterBy?.facilityId, limit });
    case "supplier":
      return getSuppliers(ctx, { search, limit });
    case "customer":
      return getCustomers(ctx, { search, limit });
    case "driver":
      return getDrivers(ctx, { search, limit });
    case "operator":
      return getOperators(ctx, { search, limit });
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
      const rawFeedstockTypeUsage = filterBy?.feedstockTypeUsage?.trim();
      const feedstockTypeUsage =
        rawFeedstockTypeUsage === "pyrolysis" || rawFeedstockTypeUsage === "blend"
          ? rawFeedstockTypeUsage
          : undefined;
      return getStorageLocations(ctx, {
        search,
        facilityId: filterBy?.facilityId,
        type,
        feedstockTypeId: filterBy?.feedstockTypeId,
        feedstockTypeUsage,
        formulationId,
        pureProductOnly,
        limit,
      });
    }
    case "vehicle":
      return getVehicles(ctx, { search, limit });
    case "feedstockType": {
      const rawUsage = filterBy?.usage?.trim() ?? filterBy?.feedstockTypeUsage?.trim();
      const usage =
        rawUsage === "pyrolysis" || rawUsage === "blend" ? rawUsage : undefined;
      return getFeedstockTypes(ctx, { search, usage, limit });
    }
    case "feedstock":
      return getFeedstocks(ctx, { search, facilityId: filterBy?.facilityId, limit });
    case "productionRun": {
      const validStatuses = productionRunStatus.enumValues as readonly string[];
      const status = filterBy?.status && validStatuses.includes(filterBy.status)
        ? (filterBy.status as (typeof productionRunStatus.enumValues)[number])
        : undefined;
      return getProductionRunsEntity(ctx, {
        search,
        facilityId: filterBy?.facilityId,
        status,
        limit,
      });
    }
    case "application":
      return getApplicationsEntity(ctx, { search, facilityId: filterBy?.facilityId, limit });
    case "formulation":
      return getFormulationsEntity(ctx, { search, limit });
    case "biocharProduct":
      return getBiocharProducts(ctx, {
        search,
        facilityId: filterBy?.facilityId,
        excludeOrderId: filterBy?.excludeOrderId,
        limit,
      });
    case "order":
      return getOrdersEntity(ctx, {
        search,
        facilityId: filterBy?.facilityId,
        limit,
      });
    case "creditBatch":
      return getCreditBatchesEntity(ctx, { search, facilityId: filterBy?.facilityId, limit });
    default:
      return [];
  }
}

export async function getEntityById(
  ctx: OrgContext,
  entityType: EntityType,
  id: string,
  // Same idea as getEntities' filterBy; only adapters that derive
  // per-caller figures (biocharProduct's remaining stock) consume it.
  filterBy?: { excludeOrderId?: string; physicalDate?: string },
): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  switch (entityType) {
    case "facility":
      return getFacilityById(ctx, id);
    case "reactor":
      return getReactorById(ctx, id);
    case "supplier":
      return getSupplierById(ctx, id);
    case "customer":
      return getCustomerById(ctx, id);
    case "driver":
      return getDriverById(ctx, id);
    case "operator":
      return getOperatorById(ctx, id);
    case "storageLocation":
      return getStorageLocationById(ctx, id, undefined, filterBy?.physicalDate);
    case "vehicle":
      return getVehicleById(ctx, id);
    case "feedstockType":
      return getFeedstockTypeById(ctx, id);
    case "feedstock":
      return getFeedstockById(ctx, id);
    case "productionRun":
      return getProductionRunEntityById(ctx, id);
    case "application":
      return getApplicationEntityById(ctx, id);
    case "formulation":
      return getFormulationEntityById(ctx, id);
    case "biocharProduct":
      return getBiocharProductEntityById(ctx, id, {
        excludeOrderId: filterBy?.excludeOrderId,
      });
    case "order":
      return getOrderEntityById(ctx, id);
    case "creditBatch":
      return getCreditBatchEntityById(ctx, id);
    default:
      return null;
  }
}
