"use server";

/**
 * Storage Locations Server Actions
 * Server-side functions for storage location CRUD operations
 */

import { z } from "zod";
import { type StorageLocation, storageLocations } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  createStorageLocation,
  deleteStorageLocation,
  getStorageLocations as getStorageLocationsData,
  getStorageLocationById as getStorageLocationByIdData,
  getStorageLocationWithFacility as getStorageLocationWithFacilityData,
  getStorageLocationsByFacility as getStorageLocationsByFacilityData,
  isStorageLocationCodeAvailable as isStorageLocationCodeAvailableData,
  updateStorageLocation,
  type PaginatedStorageLocations,
  type StorageLocationWithFacility,
} from "@/data-access/storage-locations";
import { getUser } from "@/lib/auth/server";
import {
  createStorageLocationSchema,
  deleteStorageLocationSchema,
  updateStorageLocationSchema,
  storageLocationFilterSchema,
} from "@/schemas/storage-locations";
import type { ActionResult } from "@/types/actions";

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of storage locations with filtering
 */
export async function getStorageLocationsFn(
  filters?: Partial<z.infer<typeof storageLocationFilterSchema>>
): Promise<ActionResult<PaginatedStorageLocations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? storageLocationFilterSchema.parse(filters)
      : undefined;
    const storageLocations = await getStorageLocationsData(
      user.id,
      validatedFilters
    );

    return { success: true, data: storageLocations };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Invalid filter parameters: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load storage locations",
    };
  }
}

/**
 * Get a single storage location by ID
 */
export async function getStorageLocationByIdFn(
  storageLocationId: string
): Promise<ActionResult<StorageLocation>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const storageLocation = await getStorageLocationByIdData(
      user.id,
      storageLocationId
    );
    return { success: true, data: storageLocation };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load storage location",
    };
  }
}

/**
 * Get a storage location with its facility info
 */
export async function getStorageLocationWithFacilityFn(
  storageLocationId: string
): Promise<ActionResult<StorageLocationWithFacility>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const storageLocation = await getStorageLocationWithFacilityData(
      user.id,
      storageLocationId
    );
    return { success: true, data: storageLocation };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load storage location details",
    };
  }
}

/**
 * Get storage locations by facility ID
 */
export async function getStorageLocationsByFacilityFn(
  facilityId: string
): Promise<ActionResult<StorageLocation[]>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const storageLocations = await getStorageLocationsByFacilityData(
      user.id,
      facilityId
    );
    return { success: true, data: storageLocations };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load storage locations for facility",
    };
  }
}

/**
 * Check if a storage location code is available
 */
export async function checkStorageLocationCodeFn(
  code: string,
  excludeStorageLocationId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isStorageLocationCodeAvailableData(
      user.id,
      code,
      excludeStorageLocationId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check storage location code",
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new storage location
 */
export async function createStorageLocationFn(
  data: z.infer<typeof createStorageLocationSchema>
): Promise<ActionResult<StorageLocation>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createStorageLocationSchema.parse(data);

    const storageLocation = await withAutoCode(
      "SL",
      storageLocations,
      storageLocations.code,
      undefined,
      (code) =>
        createStorageLocation(user.id, {
          code,
          name: validated.name,
          type: validated.type,
          facilityId: validated.facilityId,
          capacityKg: validated.capacityKg ?? null,
          latitude: validated.latitude ?? null,
          longitude: validated.longitude ?? null,
          storageMethod: validated.storageMethod || null,
          storageDescription: validated.storageDescription || null,
        })
    );

    return { success: true, data: storageLocation };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create storage location",
    };
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing storage location
 */
export async function updateStorageLocationFn(
  data: z.infer<typeof updateStorageLocationSchema>
): Promise<ActionResult<StorageLocation>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateStorageLocationSchema.parse(data);

    const storageLocation = await updateStorageLocation(
      user.id,
      validated.storageLocationId,
      {
        code: validated.code,
        name: validated.name,
        type: validated.type,
        facilityId: validated.facilityId,
        capacityKg: validated.capacityKg,
        latitude: validated.latitude,
        longitude: validated.longitude,
        storageMethod: validated.storageMethod,
        storageDescription: validated.storageDescription,
        supplierReferenceId: validated.supplierReferenceId,
      }
    );

    return { success: true, data: storageLocation };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update storage location",
    };
  }
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a storage location
 */
export async function deleteStorageLocationFn(
  data: z.infer<typeof deleteStorageLocationSchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteStorageLocationSchema.parse(data);
    await deleteStorageLocation(user.id, validated.storageLocationId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete storage location",
    };
  }
}
