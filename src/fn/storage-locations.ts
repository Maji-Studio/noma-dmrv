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
  getStorageLocationWithFacility,
  restoreStorageLocation,
  updateStorageLocation,
  type PaginatedStorageLocations,
  type StorageLocationWithFacility,
} from "@/data-access/storage-locations";
import {
  archiveStorageLocationSchema,
  createStorageLocationSchema,
  deleteStorageLocationSchema,
  getStorageLocationSchema,
  restoreStorageLocationSchema,
  updateStorageLocationSchema,
  storageLocationFilterSchema,
} from "@/schemas/storage-locations";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const LOG_MESSAGE = "storage bin action failed";

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of storage locations with filtering
 */
export async function getStorageLocationsFn(
  filters?: Partial<z.infer<typeof storageLocationFilterSchema>>
): Promise<ActionResult<PaginatedStorageLocations>> {
  return withAction(async (ctx) => {
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

    return storageLocations;
  }, {
    fallbackMessage: "Failed to load storage bins",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: LOG_MESSAGE, context: { op: "storage-location:list" } },
  });
}

/**
 * Get one storage bin with the same facility and inventory fields as a list
 * row, so a picker can open the storage page's own detail sheet for it.
 */
export async function getStorageLocationFn(
  data: z.infer<typeof getStorageLocationSchema>,
): Promise<ActionResult<StorageLocationWithFacility>> {
  return withAction(
    async (ctx) => {
      const validated = getStorageLocationSchema.parse(data);
      return getStorageLocationWithFacility(ctx, validated.storageLocationId);
    },
    { fallbackMessage: "Failed to load storage bin", log: { message: LOG_MESSAGE, context: { op: "storage-location:get" } } },
  );
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
  return withAction(async (ctx) => {
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
          stockMode: validated.stockMode,
          drawOrder: validated.drawOrder,
          storageMethod: validated.storageMethod || null,
          storageDescription: validated.storageDescription || null,
        }),
      CODE_CONFLICT_MESSAGES.storageLocation,
    );

    return storageLocation;
  }, {
    fallbackMessage: "Failed to create storage bin",
    log: { message: LOG_MESSAGE, context: { op: "storage-location:create" } },
  });
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
  return withAction(async (ctx) => {

    const validated = updateStorageLocationSchema.parse(data);

    const storageLocation = await updateStorageLocation(
      ctx,
      validated.storageLocationId,
      {
        expectedVersion: validated.expectedVersion,
        code: validated.code,
        name: validated.name,
        type: validated.type,
        capacityKg: validated.capacityKg,
        feedstockTypeId: validated.feedstockTypeId,
        formulationId: validated.formulationId,
        stockMode: validated.stockMode,
        drawOrder: validated.drawOrder,
        mergedAt: validated.mergedAt ? new Date(validated.mergedAt) : undefined,
        storageMethod: validated.storageMethod,
        storageDescription: validated.storageDescription,
        supplierReferenceId: validated.supplierReferenceId,
      }
    );

    return storageLocation;
  }, { fallbackMessage: "Failed to update storage bin", log: { message: LOG_MESSAGE, context: { op: "storage-location:update" } } });
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
      return archiveStorageLocation(ctx, validated.storageLocationId, validated.expectedVersion);
    },
    { fallbackMessage: "Failed to archive storage bin", log: { message: LOG_MESSAGE, context: { op: "storage-location:archive" } } },
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
      return restoreStorageLocation(ctx, validated.storageLocationId, validated.expectedVersion);
    },
    { fallbackMessage: "Failed to restore storage bin", log: { message: LOG_MESSAGE, context: { op: "storage-location:restore" } } },
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
  return withAction(async (ctx) => {

    const validated = deleteStorageLocationSchema.parse(data);
    await deleteStorageLocation(ctx, validated.storageLocationId, validated.expectedVersion);

    return undefined;
  }, { fallbackMessage: "Failed to delete storage bin", log: { message: LOG_MESSAGE, context: { op: "storage-location:delete" } } });
}
