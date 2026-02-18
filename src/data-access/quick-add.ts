/**
 * Quick Add Data Access Layer
 * Create operations for inline quick-add dialog forms
 * Minimal field requirements for rapid entity creation
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { drivers, vehicles, feedstockTypes } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

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
export async function createDriver(data: CreateDriverData): Promise<EntityOption> {
  // Check for duplicate code
  const [existing] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.code, data.code));

  if (existing) {
    throw new Error("A driver with this code already exists");
  }

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
}

// ============================================
// Vehicle Quick Add
// ============================================

export interface CreateVehicleData {
  code: string;
  name: string;
  identifier: string;
  vehicleType: string;
  fuelType: string;
  fuelConsumptionLPerKm: number;
  modelYear: number;
}

/**
 * Create a new vehicle with required fields
 * Returns EntityOption for immediate use in select dropdowns
 */
export async function createVehicle(data: CreateVehicleData): Promise<EntityOption> {
  // Check for duplicate code
  const [existingCode] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.code, data.code));

  if (existingCode) {
    throw new Error("A vehicle with this code already exists");
  }

  // Check for duplicate name (unique constraint)
  const [existingName] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.name, data.name));

  if (existingName) {
    throw new Error("A vehicle with this name already exists");
  }

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
}

// ============================================
// Feedstock Type Quick Add
// ============================================

export interface CreateFeedstockTypeData {
  code: string;
  name: string;
  category: string;
  description?: string | null;
  registryUrl?: string | null;
}

/**
 * Create a new feedstock type with required fields
 * Returns EntityOption for immediate use in select dropdowns
 */
export async function createFeedstockType(
  data: CreateFeedstockTypeData
): Promise<EntityOption> {
  // Check for duplicate code
  const [existingCode] = await db
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(eq(feedstockTypes.code, data.code));

  if (existingCode) {
    throw new Error("A feedstock type with this code already exists");
  }

  // Check for duplicate name (unique constraint)
  const [existingName] = await db
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(eq(feedstockTypes.name, data.name));

  if (existingName) {
    throw new Error("A feedstock type with this name already exists");
  }

  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      code: data.code,
      name: data.name,
      category: data.category,
      description: data.description ?? null,
      registryUrl: data.registryUrl ?? null,
    })
    .returning();

  return {
    id: feedstockType.id,
    code: feedstockType.code,
    name: feedstockType.name,
    subtitle: feedstockType.category,
  };
}
