"use server";

import { withAction } from "./with-action";

/**
 * Suppliers Server Actions
 * Server-side functions for supplier CRUD operations
 */

import { createSupplier, updateSupplier, deleteSupplier, archiveSupplier, restoreSupplier } from "@/lib/operations/suppliers";
import { addSupplierLocation, updateSupplierLocation, deleteSupplierLocation } from "@/lib/operations/supplier-locations";
import { runOperationInProcess } from "@/lib/operations/runner";
import { z } from "zod";
import { type Supplier, type SupplierLocation } from "@/db/schema";
import {
  getSuppliers as getSuppliersData,
  getSupplierById as getSupplierByIdData,
  getSupplierLocationsBySupplier as getSupplierLocationsBySupplierData,
  type PaginatedSuppliers,
} from "@/data-access/suppliers";
import { DomainError } from "@/lib/domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import {
  createSupplierWithLocationsSchema,
  updateSupplierSchema,
  supplierFilterSchema,
  createSupplierLocationSchema,
  updateSupplierLocationSchema,
  deleteSupplierLocationSchema,
} from "@/schemas/suppliers";
import { supplierVersionInput } from "@/schemas/supplier-input";
import type { ActionResult } from "@/types/actions";

const LOG_MESSAGE = "supplier action failed";
const supplierIdSchema = z.string().uuid("Invalid supplier ID");

// ============================================
// Supplier List/Query Operations
// ============================================

/**
 * Get paginated list of suppliers with filtering
 */
export async function getSuppliersFn(
  filters?: Partial<z.infer<typeof supplierFilterSchema>>
): Promise<ActionResult<PaginatedSuppliers>> {
  return withAction(async (ctx) => {
    const validatedFilters = filters
      ? supplierFilterSchema.parse(filters)
      : undefined;
    const suppliers = await getSuppliersData(ctx, validatedFilters);

    return suppliers;
  }, {
    fallbackMessage: "Failed to load suppliers",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: LOG_MESSAGE, context: { op: "supplier:list" } },
  });
}

/**
 * Get a single supplier by ID
 */
export async function getSupplierByIdFn(
  supplierId: string
): Promise<ActionResult<Supplier>> {
  return withAction(async (ctx) => {
    const supplier = await getSupplierByIdData(ctx, supplierId);
    return supplier;
  }, {
    fallbackMessage: "Failed to load supplier",
    log: { message: LOG_MESSAGE, context: { op: "supplier:get" } },
  });
}

// ============================================
// Supplier Create Operations
// ============================================

export async function createSupplierWithLocationsFn(
  data: z.infer<typeof createSupplierWithLocationsSchema>
): Promise<ActionResult<Supplier>> {
  return withAction(async (ctx) => {
    const validated = createSupplierWithLocationsSchema.parse(data);

      const result = await runOperationInProcess(createSupplier, ctx, {
        name: validated.supplier.name,
        location: validated.supplier.location || null,
        address: validated.supplier.address || null,
        contactName: validated.supplier.contactName || null,
        contactEmail: validated.supplier.contactEmail || null,
        contactPhone: validated.supplier.contactPhone || null,
        sourceRegion: validated.supplier.sourceRegion || null,
        locations: validated.locations.map(location => ({
          name: location.name || null,
          country: location.country,
          stateRegion: location.stateRegion || null,
          city: location.city || null,
          gpsLatitude: location.gpsLatitude,
          gpsLongitude: location.gpsLongitude,
          address: location.address || null,
          facilityDistances: location.facilityDistances,
          isDefault: location.isDefault,
        })),
      });
      return result.supplier;
  }, {
    fallbackMessage: "Failed to create supplier",
    log: { message: LOG_MESSAGE, context: { op: "supplier:create-with-locations" } },
  });
}

// ============================================
// Supplier Update Operations
// ============================================

/**
 * Update an existing supplier
 */
export async function updateSupplierFn(
  data: z.infer<typeof updateSupplierSchema>
): Promise<ActionResult<Supplier>> {
  return withAction(async (ctx) => {

    const validated = updateSupplierSchema.parse(data);

    const supplier = await runOperationInProcess(updateSupplier, ctx, {
      supplierId: validated.supplierId,
      expectedVersion: validated.expectedVersion,
      code: validated.code,
      name: validated.name,
      location: validated.location,
      address: validated.address,
      contactName: validated.contactName,
      contactEmail: validated.contactEmail,
      contactPhone: validated.contactPhone,
      sourceRegion: validated.sourceRegion,
    });

    return supplier;
  }, { fallbackMessage: "Failed to update supplier", log: { message: LOG_MESSAGE, context: { op: "supplier:update" } } });
}

// ============================================
// Supplier Delete Operations
// ============================================

/**
 * Delete a supplier
 */
export async function deleteSupplierFn(
  data: z.infer<typeof supplierVersionInput>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = supplierVersionInput.parse(data);
    await runOperationInProcess(deleteSupplier, ctx, validated);

    return undefined;
  }, { fallbackMessage: "Failed to delete supplier", log: { message: LOG_MESSAGE, context: { op: "supplier:delete" } } });
}

// ============================================
// Supplier Location Operations
// ============================================

export async function getSupplierLocationsBySupplierFn(
  supplierId: string
): Promise<ActionResult<SupplierLocation[]>> {
  return withAction(async (ctx) => {
    const parsed = supplierIdSchema.safeParse(supplierId);
    if (!parsed.success) {
      throw new DomainError("validation_failed", parsed.error.issues[0].message, {
        issues: validationFailed(parsed.error).issues,
      });
    }

    const locations = await getSupplierLocationsBySupplierData(ctx, supplierId);
    return locations;
  }, {
    fallbackMessage: "Failed to load supplier locations",
    log: { message: LOG_MESSAGE, context: { op: "supplier-location:list" } },
  });
}

export async function createSupplierLocationFn(
  data: z.infer<typeof createSupplierLocationSchema>
): Promise<ActionResult<SupplierLocation>> {
  return withAction(async (ctx) => {
    const validated = createSupplierLocationSchema.parse(data);

    const location = await runOperationInProcess(addSupplierLocation, ctx, {
      supplierId: validated.supplierId,
      name: validated.name || null,
      country: validated.country,
      stateRegion: validated.stateRegion || null,
      city: validated.city || null,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address || null,
      facilityDistances: validated.facilityDistances,
      isDefault: validated.isDefault,
    });

    return location;
  }, {
    fallbackMessage: "Failed to create supplier location",
    log: { message: LOG_MESSAGE, context: { op: "supplier-location:create" } },
  });
}

export async function updateSupplierLocationFn(
  data: z.infer<typeof updateSupplierLocationSchema>
): Promise<ActionResult<SupplierLocation>> {
  return withAction(async (ctx) => {

    const validated = updateSupplierLocationSchema.parse(data);

    const location = await runOperationInProcess(updateSupplierLocation, ctx, {
      supplierId: validated.supplierId,
      locationId: validated.locationId,
      expectedVersion: validated.expectedVersion,
      name: validated.name === undefined ? undefined : validated.name || null,
      country: validated.country,
      stateRegion: validated.stateRegion === undefined ? undefined : validated.stateRegion || null,
      city: validated.city === undefined ? undefined : validated.city || null,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address === undefined ? undefined : validated.address || null,
      facilityDistances: validated.facilityDistances,
      isDefault: validated.isDefault,
    });

    return location;
  }, { fallbackMessage: "Failed to update supplier location", log: { message: "supplier-location action failed", context: { op: "supplier-location:update" } } });
}

export async function deleteSupplierLocationFn(
  data: z.infer<typeof deleteSupplierLocationSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = deleteSupplierLocationSchema.parse(data);
    await runOperationInProcess(deleteSupplierLocation, ctx, validated);

    return undefined;
  }, { fallbackMessage: "Failed to delete supplier location", log: { message: "supplier-location action failed", context: { op: "supplier-location:delete" } } });
}

export async function archiveSupplierFn(
  data: z.infer<typeof supplierVersionInput>
): Promise<ActionResult<Supplier>> {
  return withAction(async (ctx) => {
    const validated = supplierVersionInput.parse(data);
    return runOperationInProcess(archiveSupplier, ctx, validated);
  }, { fallbackMessage: "Failed to archive supplier", log: { message: LOG_MESSAGE, context: { op: "supplier:archive" } } });
}

export async function restoreSupplierFn(
  data: z.infer<typeof supplierVersionInput>
): Promise<ActionResult<Supplier>> {
  return withAction(async (ctx) => {
    const validated = supplierVersionInput.parse(data);
    return runOperationInProcess(restoreSupplier, ctx, validated);
  }, { fallbackMessage: "Failed to restore supplier", log: { message: LOG_MESSAGE, context: { op: "supplier:restore" } } });
}
