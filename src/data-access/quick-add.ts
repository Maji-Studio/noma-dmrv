/**
 * Quick Add Data Access Layer
 * Create operations for inline quick-add dialog forms
 * Minimal field requirements for rapid entity creation
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { drivers, operators, vehicles, feedstockTypes, storageLocations } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";
import { guardStorageLocationName } from "./unique-name-guards";

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
export async function createDriver(userId: string, data: CreateDriverData): Promise<EntityOption> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.code, data.code));

  if (existing) {
    throw new SafeError("A driver with this code already exists");
  }

  try {
    const [driver] = await db
      .insert(drivers)
      .values({
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
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      throw new SafeError("A driver with this code already exists");
    }
    throw error;
  }
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
  userId: string,
  data: CreateOperatorData
): Promise<EntityOption> {
  requireAuth(userId);

  try {
    const [operator] = await db
      .insert(operators)
      .values({
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
export async function createVehicle(userId: string, data: CreateVehicleData): Promise<EntityOption> {
  requireAuth(userId);

  // Check for duplicate code
  const [existingCode] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.code, data.code));

  if (existingCode) {
    throw new SafeError("A vehicle with this code already exists");
  }

  // Check for duplicate name (unique constraint)
  const [existingName] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.name, data.name));

  if (existingName) {
    throw new SafeError("A vehicle with this name already exists");
  }

  try {
    const [vehicle] = await db
      .insert(vehicles)
      .values({
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
    if (error instanceof Error && error.message.includes("unique")) {
      throw new SafeError("A vehicle with this code or name already exists");
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
}

/**
 * Create a new feedstock type with required fields
 * Returns EntityOption for immediate use in select dropdowns
 */
export async function createFeedstockType(
  userId: string,
  data: CreateFeedstockTypeData
): Promise<EntityOption> {
  requireAuth(userId);
  const name = data.name.trim();
  const usage = data.usage ?? "pyrolysis";

  // Check for duplicate code
  const [existingCode] = await db
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(eq(feedstockTypes.code, data.code));

  if (existingCode) {
    throw new SafeError("A feedstock type with this code already exists");
  }

  // Check for duplicate name + usage (unique constraint)
  const [existingName] = await db
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(and(eq(feedstockTypes.name, name), eq(feedstockTypes.usage, usage)));

  if (existingName) {
    throw new SafeError("A feedstock type with this name and usage already exists");
  }

  try {
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        code: data.code,
        name,
        category: data.category,
        usage,
        description: data.description ?? null,
        registryUrl: data.registryUrl ?? null,
      })
      .returning();

    return {
      id: feedstockType.id,
      code: feedstockType.code,
      name: feedstockType.name,
      subtitle: `${feedstockType.category} · ${feedstockType.usage}`,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      throw new SafeError("A feedstock type with this code or name and usage already exists");
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
  userId: string,
  data: CreateStorageLocationData
): Promise<EntityOption> {
  requireAuth(userId);

  // Check for duplicate code
  const [existingCode] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(eq(storageLocations.code, data.code));

  if (existingCode) {
    throw new SafeError("A storage location with this code already exists");
  }

  try {
    const [location] = await guardStorageLocationName(data.name, () =>
      db
        .insert(storageLocations)
        .values({
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

    return {
      id: location.id,
      code: location.code,
      name: location.name,
      subtitle: location.type.replace(/_/g, " "),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      throw new SafeError("A storage location with this code already exists");
    }
    throw error;
  }
}
