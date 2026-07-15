"use server";

/**
 * Storage Locations Server Actions
 * Server-side functions for storage location CRUD operations
 */

import { z } from "zod";
import { type StorageLocation, storageLocations } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
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
import { requireOrgContext } from "@/lib/auth/server";
import {
  createStorageLocationSchema,
  deleteStorageLocationSchema,
  updateStorageLocationSchema,
  storageLocationFilterSchema,
} from "@/schemas/storage-locations";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";

function storageLocationActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "storage location action failed",
    context: { op },
  });
}

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
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? storageLocationFilterSchema.parse(filters)
      : undefined;
    const storageLocations = await getStorageLocationsData(
      ctx,
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
      error: storageLocationActionError(
        error,
        "Failed to load storage locations",
        "storage-location:list",
      ),
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
    const ctx = await requireOrgContext();

    const storageLocation = await getStorageLocationByIdData(
      ctx,
      storageLocationId
    );
    return { success: true, data: storageLocation };
  } catch (error) {
    return {
      success: false,
      error: storageLocationActionError(
        error,
        "Failed to load storage location",
        "storage-location:get",
      ),
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
    const ctx = await requireOrgContext();

    const storageLocation = await getStorageLocationWithFacilityData(
      ctx,
      storageLocationId
    );
    return { success: true, data: storageLocation };
  } catch (error) {
    return {
      success: false,
      error: storageLocationActionError(
        error,
        "Failed to load storage location details",
        "storage-location:detail",
      ),
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
    const ctx = await requireOrgContext();

    const storageLocations = await getStorageLocationsByFacilityData(
      ctx,
      facilityId
    );
    return { success: true, data: storageLocations };
  } catch (error) {
    return {
      success: false,
      error: storageLocationActionError(
        error,
        "Failed to load storage locations for facility",
        "storage-location:by-facility",
      ),
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
    const ctx = await requireOrgContext();

    const available = await isStorageLocationCodeAvailableData(
      ctx,
      code,
      excludeStorageLocationId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: storageLocationActionError(
        error,
        "Failed to check storage location code",
        "storage-location:check-code",
      ),
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
    const ctx = await requireOrgContext();

    const validated = createStorageLocationSchema.parse(data);

    const storageLocation = await withAutoCode(
      ctx,
      "SL",
      storageLocations,
      storageLocations.code,
      undefined,
      (code) =>
        createStorageLocation(ctx, {
          code,
          name: validated.name,
          type: validated.type,
          facilityId: validated.facilityId,
          capacityKg: validated.capacityKg ?? null,
          feedstockTypeId: validated.feedstockTypeId ?? null,
          formulationId: validated.formulationId ?? null,
          storageMethod: validated.storageMethod || null,
          storageDescription: validated.storageDescription || null,
        }),
      CODE_CONFLICT_MESSAGES.storageLocation,
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
      error: storageLocationActionError(
        error,
        "Failed to create storage location",
        "storage-location:create",
      ),
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
    const ctx = await requireOrgContext();

    const validated = updateStorageLocationSchema.parse(data);

    const storageLocation = await updateStorageLocation(
      ctx,
      validated.storageLocationId,
      {
        code: validated.code,
        name: validated.name,
        type: validated.type,
        facilityId: validated.facilityId,
        capacityKg: validated.capacityKg,
        feedstockTypeId: validated.feedstockTypeId,
        formulationId: validated.formulationId,
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
      error: storageLocationActionError(
        error,
        "Failed to update storage location",
        "storage-location:update",
      ),
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
    const ctx = await requireOrgContext();

    const validated = deleteStorageLocationSchema.parse(data);
    await deleteStorageLocation(ctx, validated.storageLocationId);

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
      error: storageLocationActionError(
        error,
        "Failed to delete storage location",
        "storage-location:delete",
      ),
    };
  }
}
