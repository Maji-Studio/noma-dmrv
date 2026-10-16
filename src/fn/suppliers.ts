"use server";

import { withAction } from "./with-action";

/**
 * Suppliers Server Actions
 * Server-side functions for supplier CRUD operations
 */

import { z } from "zod";
import { type Supplier, type SupplierLocation, suppliers } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  createSupplierWithLocations,
  deleteSupplier,
  getSuppliers as getSuppliersData,
  getSupplierById as getSupplierByIdData,
  updateSupplier,
  getSupplierLocationsBySupplier as getSupplierLocationsBySupplierData,
  createSupplierLocation,
  updateSupplierLocation,
  deleteSupplierLocation,
  type PaginatedSuppliers,
} from "@/data-access/suppliers";
import { DomainError } from "@/lib/domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import {
  createSupplierWithLocationsSchema,
  deleteSupplierSchema,
  updateSupplierSchema,
  supplierFilterSchema,
  createSupplierLocationSchema,
  updateSupplierLocationSchema,
  deleteSupplierLocationSchema,
} from "@/schemas/suppliers";
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

    const supplier = await withAutoCode(
      ctx,
      "SUP",
      suppliers,
      suppliers.code,
      undefined,
      (code) =>
        createSupplierWithLocations(ctx, {
          code,
          name: validated.supplier.name,
          location: validated.supplier.location || null,
          address: validated.supplier.address || null,
          contactName: validated.supplier.contactName || null,
          contactEmail: validated.supplier.contactEmail || null,
          contactPhone: validated.supplier.contactPhone || null,
          sourceRegion: validated.supplier.sourceRegion || null,
          locations: validated.locations.map((location) => ({
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
        })
    );

    return supplier;
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

    const supplier = await updateSupplier(ctx, validated.supplierId, {
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
  data: z.infer<typeof deleteSupplierSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = deleteSupplierSchema.parse(data);
    await deleteSupplier(ctx, validated.supplierId, validated.expectedVersion);

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

    const location = await createSupplierLocation(ctx, {
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

    const location = await updateSupplierLocation(ctx, validated.locationId, {
      expectedVersion: validated.expectedVersion,
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
  }, { fallbackMessage: "Failed to update supplier location", log: { message: "supplier-location action failed", context: { op: "supplier-location:update" } } });
}

export async function deleteSupplierLocationFn(
  data: z.infer<typeof deleteSupplierLocationSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = deleteSupplierLocationSchema.parse(data);
    await deleteSupplierLocation(ctx, validated.locationId, validated.expectedVersion);

    return undefined;
  }, { fallbackMessage: "Failed to delete supplier location", log: { message: "supplier-location action failed", context: { op: "supplier-location:delete" } } });
}
