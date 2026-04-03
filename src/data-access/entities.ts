/**
 * Entity Data Access Layer
 * Database queries for searchable entity selection
 */

import { ilike, or, eq, and, inArray, sql, SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  facilities,
  reactors,
  suppliers,
  customers,
  drivers,
  operators,
  storageLocations,
  vehicles,
  feedstockTypes,
  feedstocks,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  formulations,
  creditBatches,
} from "@/db/schema";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import type { StorageLocationType } from "@/schemas/storage-locations";

interface GetEntitiesParams {
  entityType: EntityType;
  search?: string;
  filterBy?: Record<string, string>;
  limit?: number;
}

export async function getEntities(
  params: GetEntitiesParams
): Promise<EntityOption[]> {
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
        limit,
      });
    }
    case "vehicle":
      return getVehicles({ search, limit });
    case "feedstockType":
      return getFeedstockTypes({ search, limit });
    case "feedstock":
      return getFeedstocks({ search, facilityId: filterBy?.facilityId, limit });
    case "productionRun":
      return getProductionRunsEntity({ search, facilityId: filterBy?.facilityId, limit });
    case "formulation":
      return getFormulationsEntity({ search, limit });
    case "creditBatch":
      return getCreditBatchesEntity({ search, facilityId: filterBy?.facilityId, limit });
    default:
      return [];
  }
}

export async function getEntityById(
  entityType: EntityType,
  id: string
): Promise<EntityOption | null> {
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
    case "formulation":
      return getFormulationEntityById(id);
    case "creditBatch":
      return getCreditBatchEntityById(id);
    default:
      return null;
  }
}

// ============================================
// Facilities
// ============================================

async function getFacilities(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(facilities.code, searchPattern),
      ilike(facilities.name, searchPattern),
      ilike(facilities.location, searchPattern)
    );
  }

  const results = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      location: facilities.location,
    })
    .from(facilities)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.location ?? undefined,
  }));
}

async function getFacilityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      location: facilities.location,
    })
    .from(facilities)
    .where(eq(facilities.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.location ?? undefined,
  };
}

// ============================================
// Reactors
// ============================================

async function getReactors(params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [];

  if (facilityId) {
    conditions.push(eq(reactors.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(reactors.code, searchPattern),
        ilike(reactors.identifier, searchPattern),
        ilike(reactors.reactorType, searchPattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      reactorType: reactors.reactorType,
    })
    .from(reactors)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.identifier,
    subtitle: r.reactorType,
  }));
}

async function getReactorById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      reactorType: reactors.reactorType,
    })
    .from(reactors)
    .where(eq(reactors.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.identifier,
    subtitle: result.reactorType,
  };
}

// ============================================
// Suppliers
// ============================================

async function getSuppliers(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(suppliers.code, searchPattern),
      ilike(suppliers.name, searchPattern),
      ilike(suppliers.location, searchPattern)
    );
  }

  const results = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      location: suppliers.location,
    })
    .from(suppliers)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.location ?? undefined,
  }));
}

async function getSupplierById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      location: suppliers.location,
    })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.location ?? undefined,
  };
}

// ============================================
// Customers
// ============================================

async function getCustomers(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(customers.code, searchPattern),
      ilike(customers.name, searchPattern),
      ilike(customers.cropType, searchPattern)
    );
  }

  const results = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      cropType: customers.cropType,
    })
    .from(customers)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.cropType ?? undefined,
  }));
}

async function getCustomerById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      cropType: customers.cropType,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.cropType ?? undefined,
  };
}

// ============================================
// Drivers
// ============================================

async function getDrivers(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(drivers.code, searchPattern),
      ilike(drivers.name, searchPattern)
    );
  }

  const results = await db
    .select({
      id: drivers.id,
      code: drivers.code,
      name: drivers.name,
      licenseNumber: drivers.licenseNumber,
    })
    .from(drivers)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.licenseNumber ?? undefined,
  }));
}

async function getDriverById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: drivers.id,
      code: drivers.code,
      name: drivers.name,
      licenseNumber: drivers.licenseNumber,
    })
    .from(drivers)
    .where(eq(drivers.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.licenseNumber ?? undefined,
  };
}

// ============================================
// Operators
// ============================================

async function getOperators(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = ilike(operators.name, searchPattern);
  }

  const results = await db
    .select({
      id: operators.id,
      name: operators.name,
      credentials: operators.credentials,
    })
    .from(operators)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.name,
    name: r.name,
    subtitle: r.credentials ?? undefined,
  }));
}

async function getOperatorById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: operators.id,
      name: operators.name,
      credentials: operators.credentials,
    })
    .from(operators)
    .where(eq(operators.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.name,
    name: result.name,
    subtitle: result.credentials ?? undefined,
  };
}

// ============================================
// Storage Locations
// ============================================

function formatStorageLocationSubtitle(
  type: string,
  feedstockTypeName: string | null,
  totalStoredKg: number,
  totalConsumedKg: number,
  totalProducedKg: number,
  totalAllocatedKg: number,
  totalProductKg: number,
  biocharEquivalentKg: number,
): string {
  switch (type) {
    case "feedstock_bin": {
      const remainingKg = Math.max(0, totalStoredKg - totalConsumedKg);
      if (!feedstockTypeName && remainingKg === 0) {
        return "Empty";
      }

      const parts: string[] = [];
      if (feedstockTypeName) {
        parts.push(feedstockTypeName);
      }
      parts.push(`${Math.round(remainingKg).toLocaleString()} kg remaining`);
      return parts.join(" · ");
    }
    case "biochar_bin": {
      const availableBiocharKg = Math.max(0, totalProducedKg - totalAllocatedKg);
      if (availableBiocharKg === 0) {
        return "Empty";
      }
      return `${Math.round(availableBiocharKg).toLocaleString()} kg biochar available`;
    }
    case "product_bin": {
      if (totalProductKg === 0) {
        return "Empty";
      }

      const parts = [`${Math.round(totalProductKg).toLocaleString()} kg products`];
      if (biocharEquivalentKg > 0) {
        parts.push(`${Math.round(biocharEquivalentKg).toLocaleString()} kg biochar eq`);
      }
      return parts.join(" · ");
    }
    case "ingredient_bin": {
      const remainingKg = Math.max(0, totalStoredKg - totalConsumedKg);
      if (!feedstockTypeName && remainingKg === 0) {
        return "Ingredient Bin";
      }

      const parts: string[] = [];
      if (feedstockTypeName) {
        parts.push(feedstockTypeName);
      }
      parts.push(`${Math.round(remainingKg).toLocaleString()} kg remaining`);
      return parts.join(" · ");
    }
    default:
      return "Empty";
  }
}

const feedstockInventoryAggregate = db
  .select({
    storageLocationId: feedstocks.storageLocationId,
    feedstockTypeName: sql<string | null>`string_agg(DISTINCT ${feedstockTypes.name}, ', ' ORDER BY ${feedstockTypes.name})`.as("feedstock_type_name"),
    totalStoredKg: sql<number>`SUM(${feedstocks.massDryKg})`.as("total_stored_kg"),
  })
  .from(feedstocks)
  .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
  .groupBy(feedstocks.storageLocationId)
  .as("feedstock_inventory_agg");

const productionRunConsumptionAggregate = db
  .select({
    storageLocationId: productionRuns.feedstockStorageLocationId,
    totalConsumedKg: sql<number>`COALESCE(SUM(${productionRunFeedstocks.massUsedKg}), 0)`.as("total_consumed_kg"),
  })
  .from(productionRuns)
  .leftJoin(
    productionRunFeedstocks,
    eq(productionRunFeedstocks.productionRunId, productionRuns.id)
  )
  .groupBy(productionRuns.feedstockStorageLocationId)
  .as("production_run_consumption_agg");

const biocharOutputAggregate = db
  .select({
    storageLocationId: productionRuns.biocharStorageLocationId,
    totalProducedKg: sql<number>`COALESCE(SUM(${productionRuns.biocharOutputKg}), 0)`.as("total_produced_kg"),
  })
  .from(productionRuns)
  .groupBy(productionRuns.biocharStorageLocationId)
  .as("biochar_output_agg");

const biocharAllocationAggregate = db
  .select({
    storageLocationId: productionRuns.biocharStorageLocationId,
    totalAllocatedKg: sql<number>`
      COALESCE(
        SUM(
          COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
        ),
        0
      )
    `.as("total_allocated_kg"),
  })
  .from(productionRuns)
  .innerJoin(
    biocharProducts,
    eq(biocharProducts.linkedProductionRunId, productionRuns.id)
  )
  .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
  .groupBy(productionRuns.biocharStorageLocationId)
  .as("biochar_allocation_agg");

const productInventoryAggregate = db
  .select({
    storageLocationId: biocharProducts.storageLocationId,
    totalProductKg: sql<number>`COALESCE(SUM(${biocharProducts.massKg}), 0)`.as("total_product_kg"),
    biocharEquivalentKg: sql<number>`
      COALESCE(
        SUM(
          COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
        ),
        0
      )
    `.as("biochar_equivalent_kg"),
  })
  .from(biocharProducts)
  .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
  .groupBy(biocharProducts.storageLocationId)
  .as("product_inventory_agg");

async function getStorageLocations(params: {
  search?: string;
  facilityId?: string;
  type?: StorageLocationType | StorageLocationType[];
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, type, limit } = params;

  const conditions: SQL[] = [];

  if (facilityId) {
    conditions.push(eq(storageLocations.facilityId, facilityId));
  }

  if (type) {
    if (Array.isArray(type)) {
      conditions.push(inArray(storageLocations.type, type));
    } else {
      conditions.push(eq(storageLocations.type, type));
    }
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(storageLocations.code, searchPattern),
        ilike(storageLocations.name, searchPattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      feedstockTypeName: feedstockInventoryAggregate.feedstockTypeName,
      totalStoredKg: sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredKg}, 0)`,
      totalConsumedKg: sql<number>`COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)`,
      totalProducedKg: sql<number>`COALESCE(${biocharOutputAggregate.totalProducedKg}, 0)`,
      totalAllocatedKg: sql<number>`COALESCE(${biocharAllocationAggregate.totalAllocatedKg}, 0)`,
      totalProductKg: sql<number>`COALESCE(${productInventoryAggregate.totalProductKg}, 0)`,
      biocharEquivalentKg: sql<number>`COALESCE(${productInventoryAggregate.biocharEquivalentKg}, 0)`,
    })
    .from(storageLocations)
    .leftJoin(
      feedstockInventoryAggregate,
      eq(storageLocations.id, feedstockInventoryAggregate.storageLocationId)
    )
    .leftJoin(
      productionRunConsumptionAggregate,
      eq(storageLocations.id, productionRunConsumptionAggregate.storageLocationId)
    )
    .leftJoin(
      biocharOutputAggregate,
      eq(storageLocations.id, biocharOutputAggregate.storageLocationId)
    )
    .leftJoin(
      biocharAllocationAggregate,
      eq(storageLocations.id, biocharAllocationAggregate.storageLocationId)
    )
    .leftJoin(
      productInventoryAggregate,
      eq(storageLocations.id, productInventoryAggregate.storageLocationId)
    )
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: formatStorageLocationSubtitle(
      r.type,
      r.feedstockTypeName,
      r.totalStoredKg,
      r.totalConsumedKg,
      r.totalProducedKg,
      r.totalAllocatedKg,
      r.totalProductKg,
      r.biocharEquivalentKg
    ),
  }));
}

async function getStorageLocationById(
  id: string
): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      feedstockTypeName: feedstockInventoryAggregate.feedstockTypeName,
      totalStoredKg: sql<number>`COALESCE(${feedstockInventoryAggregate.totalStoredKg}, 0)`,
      totalConsumedKg: sql<number>`COALESCE(${productionRunConsumptionAggregate.totalConsumedKg}, 0)`,
      totalProducedKg: sql<number>`COALESCE(${biocharOutputAggregate.totalProducedKg}, 0)`,
      totalAllocatedKg: sql<number>`COALESCE(${biocharAllocationAggregate.totalAllocatedKg}, 0)`,
      totalProductKg: sql<number>`COALESCE(${productInventoryAggregate.totalProductKg}, 0)`,
      biocharEquivalentKg: sql<number>`COALESCE(${productInventoryAggregate.biocharEquivalentKg}, 0)`,
    })
    .from(storageLocations)
    .leftJoin(
      feedstockInventoryAggregate,
      eq(storageLocations.id, feedstockInventoryAggregate.storageLocationId)
    )
    .leftJoin(
      productionRunConsumptionAggregate,
      eq(storageLocations.id, productionRunConsumptionAggregate.storageLocationId)
    )
    .leftJoin(
      biocharOutputAggregate,
      eq(storageLocations.id, biocharOutputAggregate.storageLocationId)
    )
    .leftJoin(
      biocharAllocationAggregate,
      eq(storageLocations.id, biocharAllocationAggregate.storageLocationId)
    )
    .leftJoin(
      productInventoryAggregate,
      eq(storageLocations.id, productInventoryAggregate.storageLocationId)
    )
    .where(eq(storageLocations.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: formatStorageLocationSubtitle(
      result.type,
      result.feedstockTypeName,
      result.totalStoredKg,
      result.totalConsumedKg,
      result.totalProducedKg,
      result.totalAllocatedKg,
      result.totalProductKg,
      result.biocharEquivalentKg
    ),
  };
}

// ============================================
// Vehicles
// ============================================

async function getVehicles(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(vehicles.code, searchPattern),
      ilike(vehicles.name, searchPattern),
      ilike(vehicles.vehicleType, searchPattern)
    );
  }

  const results = await db
    .select({
      id: vehicles.id,
      code: vehicles.code,
      name: vehicles.name,
      vehicleType: vehicles.vehicleType,
    })
    .from(vehicles)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.vehicleType,
  }));
}

async function getVehicleById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: vehicles.id,
      code: vehicles.code,
      name: vehicles.name,
      vehicleType: vehicles.vehicleType,
    })
    .from(vehicles)
    .where(eq(vehicles.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.vehicleType,
  };
}

// ============================================
// Feedstock Types
// ============================================

async function getFeedstockTypes(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(feedstockTypes.code, searchPattern),
      ilike(feedstockTypes.name, searchPattern),
      ilike(feedstockTypes.category, searchPattern)
    );
  }

  const results = await db
    .select({
      id: feedstockTypes.id,
      code: feedstockTypes.code,
      name: feedstockTypes.name,
      category: feedstockTypes.category,
    })
    .from(feedstockTypes)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.category,
  }));
}

async function getFeedstockTypeById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: feedstockTypes.id,
      code: feedstockTypes.code,
      name: feedstockTypes.name,
      category: feedstockTypes.category,
    })
    .from(feedstockTypes)
    .where(eq(feedstockTypes.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.category,
  };
}

// ============================================
// Feedstocks (individual batches)
// ============================================

async function getFeedstocks(params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [];

  if (facilityId) {
    conditions.push(eq(feedstocks.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(feedstocks.code, searchPattern));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: feedstocks.id,
      code: feedstocks.code,
      massDryKg: feedstocks.massDryKg,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(feedstocks)
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.feedstockTypeName ?? r.code,
    subtitle: r.massDryKg ? `${r.massDryKg.toFixed(1)} kg dry` : undefined,
  }));
}

async function getFeedstockById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: feedstocks.id,
      code: feedstocks.code,
      massDryKg: feedstocks.massDryKg,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(feedstocks)
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .where(eq(feedstocks.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.feedstockTypeName ?? result.code,
    subtitle: result.massDryKg ? `${result.massDryKg.toFixed(1)} kg dry` : undefined,
  };
}

// ============================================
// Production Runs
// ============================================

async function getProductionRunsEntity(params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [];

  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(productionRuns.code, searchPattern));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
      status: productionRuns.status,
      facilityName: facilities.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharStorageName: storageLocations.name,
    })
    .from(productionRuns)
    .leftJoin(facilities, eq(productionRuns.facilityId, facilities.id))
    .leftJoin(storageLocations, eq(productionRuns.biocharStorageLocationId, storageLocations.id))
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.date ? new Date(r.date).toLocaleDateString() : r.code,
    subtitle: [
      r.facilityName ? `${r.facilityName} · ${r.status}` : r.status,
      r.biocharOutputKg !== null ? `${Math.round(r.biocharOutputKg).toLocaleString()} kg biochar` : undefined,
      r.biocharStorageName ? `→ ${r.biocharStorageName}` : undefined,
    ].filter(Boolean).join(" · "),
  }));
}

async function getProductionRunEntityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
      status: productionRuns.status,
      facilityName: facilities.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharStorageName: storageLocations.name,
    })
    .from(productionRuns)
    .leftJoin(facilities, eq(productionRuns.facilityId, facilities.id))
    .leftJoin(storageLocations, eq(productionRuns.biocharStorageLocationId, storageLocations.id))
    .where(eq(productionRuns.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.date ? new Date(result.date).toLocaleDateString() : result.code,
    subtitle: [
      result.facilityName ? `${result.facilityName} · ${result.status}` : result.status,
      result.biocharOutputKg !== null ? `${Math.round(result.biocharOutputKg).toLocaleString()} kg biochar` : undefined,
      result.biocharStorageName ? `→ ${result.biocharStorageName}` : undefined,
    ].filter(Boolean).join(" · "),
  };
}

// ============================================
// Formulations
// ============================================

async function getFormulationsEntity(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(formulations.code, searchPattern),
      ilike(formulations.name, searchPattern),
      ilike(formulations.description, searchPattern)
    );
  }

  const results = await db
    .select({
      id: formulations.id,
      code: formulations.code,
      name: formulations.name,
      biocharRatio: formulations.biocharRatio,
    })
    .from(formulations)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.biocharRatio !== null ? `${Math.round(r.biocharRatio * 100)}% biochar` : undefined,
  }));
}

async function getFormulationEntityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: formulations.id,
      code: formulations.code,
      name: formulations.name,
      biocharRatio: formulations.biocharRatio,
    })
    .from(formulations)
    .where(eq(formulations.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.biocharRatio !== null ? `${Math.round(result.biocharRatio * 100)}% biochar` : undefined,
  };
}

// ============================================
// Credit Batches
// ============================================

async function getCreditBatchesEntity(params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [];

  if (facilityId) {
    conditions.push(eq(creditBatches.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(creditBatches.code, searchPattern),
        ilike(creditBatches.registry, searchPattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
      facilityName: facilities.name,
    })
    .from(creditBatches)
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.code,
    subtitle: [r.facilityName, r.status].filter(Boolean).join(" · "),
  }));
}

async function getCreditBatchEntityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
      facilityName: facilities.name,
    })
    .from(creditBatches)
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
    .where(eq(creditBatches.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.code,
    subtitle: [result.facilityName, result.status].filter(Boolean).join(" · "),
  };
}
