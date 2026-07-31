/**
 * Quick Add Data Access Layer
 * Create operations for inline quick-add dialog forms
 * Minimal field requirements for rapid entity creation
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  drivers,
  operators,
  vehicles,
  feedstockTypes,
  formulations,
  storageLocations,
} from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { assertSameOrg, requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { guardStorageLocationName } from "./unique-name-guards";
import { isPgUniqueViolation } from "@/db/errors";
import { getStorageLocationById } from "./entities/storage-locations";

const VEHICLE_NAME_CONSTRAINT = "vehicles_organization_id_name_unique";
const FEEDSTOCK_TYPE_NAME_USAGE_CONSTRAINT =
  "feedstock_types_organization_id_name_usage_unique";

// ============================================
// Driver Quick Add
// ============================================

export interface CreateDriverData {
  code: string;
  name: string;
  licenseNumber?: string | null;
  contactPhone?: string | null;
}

/**
 * Create a new driver with minimal required fields
 * Returns EntityOption for immediate use in select dropdowns
 */
export async function createDriver(ctx: OrgContext, data: CreateDriverData): Promise<EntityOption> {
  requireOrgScope(ctx);

  const [driver] = await db
    .insert(drivers)
    .values({
      organizationId: ctx.organizationId,
      code: data.code,
      name: data.name,
      licenseNumber: data.licenseNumber ?? null,
      contactPhone: data.contactPhone ?? null,
    })
    .returning();

  return {
    id: driver.id,
    code: driver.code,
    name: driver.name,
    subtitle: driver.licenseNumber ?? undefined,
  };
}

// ============================================
// Operator Quick Add
// ============================================

export interface CreateOperatorData {
  name: string;
  credentials?: string | null;
  contactPhone?: string | null;
}

export async function createOperator(
  ctx: OrgContext,
  data: CreateOperatorData
): Promise<EntityOption> {
  requireOrgScope(ctx);

  try {
    const [operator] = await db
      .insert(operators)
      .values({
        organizationId: ctx.organizationId,
        name: data.name,
        credentials: data.credentials ?? null,
        contactPhone: data.contactPhone ?? null,
      })
      .returning();

    return {
      id: operator.id,
      code: operator.name,
      name: operator.name,
      subtitle: operator.credentials ?? undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      throw new SafeError("An operator with this name already exists");
    }
    throw error;
  }
}

// ============================================
// Vehicle Quick Add
// ============================================

export interface CreateVehicleData {
  code: string;
  name: string;
  // vehicleType is the only required vehicle attribute — it selects the
  // Isometric component emission factor. The rest is optional metadata.
  vehicleType: string;
  identifier?: string | null;
  fuelType?: string | null;
  fuelConsumptionLPerKm?: number | null;
  modelYear?: number | null;
}

/**
 * Create a new vehicle with required fields
 * Returns EntityOption for immediate use in select dropdowns
 */
export async function createVehicle(ctx: OrgContext, data: CreateVehicleData): Promise<EntityOption> {
  requireOrgScope(ctx);

  // Check for duplicate name (unique constraint)
  const [existingName] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.name, data.name),
        eq(vehicles.organizationId, ctx.organizationId),
      ),
    );

  if (existingName) {
    throw new SafeError("A vehicle with this name already exists");
  }

  try {
    const [vehicle] = await db
      .insert(vehicles)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        name: data.name,
        identifier: data.identifier,
        vehicleType: data.vehicleType,
        fuelType: data.fuelType,
        fuelConsumptionLPerKm: data.fuelConsumptionLPerKm,
        modelYear: data.modelYear,
      })
      .returning();

    return {
      id: vehicle.id,
      code: vehicle.code,
      name: vehicle.name,
      subtitle: vehicle.vehicleType,
    };
  } catch (error) {
    if (isPgUniqueViolation(error, VEHICLE_NAME_CONSTRAINT)) {
      throw new SafeError("A vehicle with this name already exists");
    }
    throw error;
  }
}

// ============================================
// Feedstock Type Quick Add
// ============================================

export interface CreateFeedstockTypeData {
  code: string;
  name: string;
  category: string;
  usage?: "pyrolysis" | "blend";
  description?: string | null;
  registryUrl?: string | null;
  isometricFeedstockTypeId?: string | null;
}

/**
 * Create a new feedstock type with required fields
 * Returns EntityOption for immediate use in select dropdowns
 */
export async function createFeedstockType(
  ctx: OrgContext,
  data: CreateFeedstockTypeData
): Promise<EntityOption> {
  requireOrgScope(ctx);
  const name = data.name.trim();
  const usage = data.usage ?? "pyrolysis";

  // Check for duplicate name + usage (unique constraint)
  const [existingName] = await db
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(
      and(
        eq(feedstockTypes.name, name),
        eq(feedstockTypes.usage, usage),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    );

  if (existingName) {
    throw new SafeError("A feedstock type with this name and usage already exists");
  }

  try {
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        name,
        category: data.category,
        usage,
        description: data.description ?? null,
        registryUrl: data.registryUrl ?? null,
        isometricFeedstockTypeId: data.isometricFeedstockTypeId ?? null,
      })
      .returning();

    return {
      id: feedstockType.id,
      code: feedstockType.code,
      name: feedstockType.name,
      subtitle: `${feedstockType.category} · ${feedstockType.usage}`,
    };
  } catch (error) {
    if (isPgUniqueViolation(error, FEEDSTOCK_TYPE_NAME_USAGE_CONSTRAINT)) {
      throw new SafeError("A feedstock type with this name and usage already exists");
    }
    throw error;
  }
}

// ============================================
// Storage Location Quick Add
// ============================================

export interface CreateStorageLocationData {
  code: string;
  name: string;
  type: StorageLocationType;
  facilityId: string;
  capacityKg?: number | null;
  feedstockTypeId?: string | null;
  formulationId?: string | null;
}

/**
 * Create a new storage location with minimal required fields
 * Returns EntityOption for immediate use in select dropdowns
 */
export async function createStorageLocation(
  ctx: OrgContext,
  data: CreateStorageLocationData
): Promise<EntityOption> {
  requireOrgScope(ctx);

  if (data.feedstockTypeId) {
    await assertSameOrg(ctx, feedstockTypes, data.feedstockTypeId);
  }
  if (data.formulationId) {
    await assertSameOrg(ctx, formulations, data.formulationId);
  }

  const [location] = await guardStorageLocationName(ctx, data.name, () =>
    db
      .insert(storageLocations)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        name: data.name,
        type: data.type,
        facilityId: data.facilityId,
        capacityKg: data.capacityKg ?? null,
        feedstockTypeId: data.feedstockTypeId ?? null,
        formulationId: data.formulationId ?? null,
      })
      .returning(),
  );

  const enriched = await getStorageLocationById(ctx, location.id);
  return enriched ?? {
    id: location.id,
    code: location.code,
    name: location.name,
  };
}
