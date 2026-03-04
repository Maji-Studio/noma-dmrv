/**
 * Entity Data Access Layer
 * Database queries for searchable entity selection
 */

import { ilike, or, eq, and, inArray, SQL } from "drizzle-orm";
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
  feedstockDeliveries,
  productionRuns,
  formulations,
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
    case "feedstockDelivery":
      return getFeedstockDeliveriesEntity({ search, limit });
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
    case "feedstockDelivery":
      return getFeedstockDeliveryEntityById(id);
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
        ilike(reactors.type, searchPattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      type: reactors.type,
    })
    .from(reactors)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.identifier,
    subtitle: r.type,
  }));
}

async function getReactorById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      type: reactors.type,
    })
    .from(reactors)
    .where(eq(reactors.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.identifier,
    subtitle: result.type,
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
    })
    .from(storageLocations)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.type,
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
    })
    .from(storageLocations)
    .where(eq(storageLocations.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.type,
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
      facilityCode: facilities.code,
    })
    .from(productionRuns)
    .leftJoin(facilities, eq(productionRuns.facilityId, facilities.id))
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.date ? new Date(r.date).toLocaleDateString() : r.code,
    subtitle: r.facilityCode ? `${r.facilityCode} - ${r.status}` : r.status,
  }));
}

async function getProductionRunEntityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
      status: productionRuns.status,
      facilityCode: facilities.code,
    })
    .from(productionRuns)
    .leftJoin(facilities, eq(productionRuns.facilityId, facilities.id))
    .where(eq(productionRuns.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.date ? new Date(result.date).toLocaleDateString() : result.code,
    subtitle: result.facilityCode ? `${result.facilityCode} - ${result.status}` : result.status,
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
      compostRatio: formulations.compostRatio,
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
      compostRatio: formulations.compostRatio,
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
// Feedstock Deliveries
// ============================================

async function getFeedstockDeliveriesEntity(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(feedstockDeliveries.code, searchPattern),
        ilike(suppliers.name, searchPattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: feedstockDeliveries.id,
      code: feedstockDeliveries.code,
      deliveryDate: feedstockDeliveries.deliveryDate,
      facilityId: feedstockDeliveries.facilityId,
      supplierName: suppliers.name,
    })
    .from(feedstockDeliveries)
    .leftJoin(suppliers, eq(feedstockDeliveries.supplierId, suppliers.id))
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: `${r.code} (${new Date(r.deliveryDate).toLocaleDateString()})`,
    subtitle: r.supplierName ?? undefined,
  }));
}

async function getFeedstockDeliveryEntityById(
  id: string
): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: feedstockDeliveries.id,
      code: feedstockDeliveries.code,
      deliveryDate: feedstockDeliveries.deliveryDate,
      facilityId: feedstockDeliveries.facilityId,
      supplierName: suppliers.name,
    })
    .from(feedstockDeliveries)
    .leftJoin(suppliers, eq(feedstockDeliveries.supplierId, suppliers.id))
    .where(eq(feedstockDeliveries.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: `${result.code} (${new Date(result.deliveryDate).toLocaleDateString()})`,
    subtitle: result.supplierName ?? undefined,
  };
}
