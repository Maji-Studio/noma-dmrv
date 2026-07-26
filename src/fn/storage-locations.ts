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
import { requireOrgFacility } from "@/data-access/utils";
import {
  archiveStorageLocation,
  createStorageLocation,
  deleteStorageLocation,
  getStorageLocations as getStorageLocationsData,
  getStorageLocationById as getStorageLocationByIdData,
  getStorageLocationWithFacility as getStorageLocationWithFacilityData,
  getStorageLocationsByFacility as getStorageLocationsByFacilityData,
  isStorageLocationCodeAvailable as isStorageLocationCodeAvailableData,
  restoreStorageLocation,
  updateStorageLocation,
  type PaginatedStorageLocations,
  type StorageLocationWithFacility,
} from "@/data-access/storage-locations";
import { requireOrgContext } from "@/lib/auth/server";
import {
  archiveStorageLocationSchema,
  createStorageLocationSchema,
  deleteStorageLocationSchema,
  restoreStorageLocationSchema,
  updateStorageLocationSchema,
  storageLocationFilterSchema,
} from "@/schemas/storage-locations";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";
import { withAction } from "./with-action";

function storageLocationActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "storage bin action failed",
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
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
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
        "Failed to load storage bins",
        "storage-location:list",
      ),
    };
  }
}

/**
 * Get a single storage bin by ID
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
        "Failed to load storage bin",
        "storage-location:get",
      ),
    };
  }
}

/**
 * Get a storage bin with its facility info
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
        "Failed to load storage bin details",
        "storage-location:detail",
      ),
    };
  }
}

/**
 * Get storage bins by facility ID
 */
export async function getStorageLocationsByFacilityFn(
  facilityId: string
): Promise<ActionResult<StorageLocation[]>> {
  try {
    const ctx = await requireOrgContext();

    await requireOrgFacility(ctx, facilityId);
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
        "Failed to load storage bins for facility",
        "storage-location:by-facility",
      ),
    };
  }
}

/**
 * Check if a storage bin code is available
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
        "Failed to check storage bin code",
        "storage-location:check-code",
      ),
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new storage bin
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
        "Failed to create storage bin",
        "storage-location:create",
      ),
    };
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing storage bin
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
        "Failed to update storage bin",
        "storage-location:update",
      ),
    };
  }
}

// ============================================
// Archive Operations
// ============================================

/**
 * Archive a storage bin while retaining all operational history.
 */
export async function archiveStorageLocationFn(
  data: z.infer<typeof archiveStorageLocationSchema>,
): Promise<ActionResult<StorageLocation>> {
  return withAction(
    async (ctx) => {
      const validated = archiveStorageLocationSchema.parse(data);
      return archiveStorageLocation(ctx, validated.storageLocationId);
    },
    { fallbackMessage: "Failed to archive storage bin" },
  );
}

/**
 * Restore an individually archived storage bin.
 */
export async function restoreStorageLocationFn(
  data: z.infer<typeof restoreStorageLocationSchema>,
): Promise<ActionResult<StorageLocation>> {
  return withAction(
    async (ctx) => {
      const validated = restoreStorageLocationSchema.parse(data);
      return restoreStorageLocation(ctx, validated.storageLocationId);
    },
    { fallbackMessage: "Failed to restore storage bin" },
  );
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a storage bin
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
        "Failed to delete storage bin",
        "storage-location:delete",
      ),
    };
  }
}
