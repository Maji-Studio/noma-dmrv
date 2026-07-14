"use server";

/**
 * Suppliers Server Actions
 * Server-side functions for supplier CRUD operations
 */

import { z } from "zod";
import { type Supplier, type SupplierLocation, suppliers } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import {
  createSupplier,
  createSupplierWithLocations,
  deleteSupplier,
  getSuppliers as getSuppliersData,
  getSupplierById as getSupplierByIdData,
  getSupplierLocations as getSupplierLocationsData,
  isSupplierCodeAvailable as isSupplierCodeAvailableData,
  getSupplierOptions as getSupplierOptionsData,
  updateSupplier,
  getSupplierLocationsBySupplier as getSupplierLocationsBySupplierData,
  createSupplierLocation,
  updateSupplierLocation,
  deleteSupplierLocation,
  type PaginatedSuppliers,
} from "@/data-access/suppliers";
import { requireOrgContext } from "@/lib/auth/server";
import {
  createSupplierSchema,
  createSupplierWithLocationsSchema,
  deleteSupplierSchema,
  updateSupplierSchema,
  supplierFilterSchema,
  createSupplierLocationSchema,
  updateSupplierLocationSchema,
  deleteSupplierLocationSchema,
} from "@/schemas/suppliers";
import { resolveDistanceSource } from "@/schemas/distance-source";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";

function supplierActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "supplier action failed",
    context: { op },
  });
}

// ============================================
// Supplier List/Query Operations
// ============================================

/**
 * Get paginated list of suppliers with filtering
 */
export async function getSuppliersFn(
  filters?: Partial<z.infer<typeof supplierFilterSchema>>
): Promise<ActionResult<PaginatedSuppliers>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? supplierFilterSchema.parse(filters)
      : undefined;
    const suppliers = await getSuppliersData(ctx, validatedFilters);

    return { success: true, data: suppliers };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Invalid filter parameters: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to load suppliers",
        "supplier:list",
      ),
    };
  }
}

/**
 * Get a single supplier by ID
 */
export async function getSupplierByIdFn(
  supplierId: string
): Promise<ActionResult<Supplier>> {
  try {
    const ctx = await requireOrgContext();

    const supplier = await getSupplierByIdData(ctx, supplierId);
    return { success: true, data: supplier };
  } catch (error) {
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to load supplier",
        "supplier:get",
      ),
    };
  }
}

/**
 * Get unique locations from all suppliers
 */
export async function getSupplierLocationsFn(): Promise<
  ActionResult<string[]>
> {
  try {
    const ctx = await requireOrgContext();

    const locations = await getSupplierLocationsData(ctx);
    return { success: true, data: locations };
  } catch (error) {
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to load locations",
        "supplier:locations",
      ),
    };
  }
}

/**
 * Get supplier options for dropdowns
 */
export async function getSupplierOptionsFn(): Promise<
  ActionResult<Array<{ id: string; code: string; name: string }>>
> {
  try {
    const ctx = await requireOrgContext();

    const options = await getSupplierOptionsData(ctx);
    return { success: true, data: options };
  } catch (error) {
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to load supplier options",
        "supplier:options",
      ),
    };
  }
}

/**
 * Check if a supplier code is available
 */
export async function checkSupplierCodeFn(
  code: string,
  excludeSupplierId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const ctx = await requireOrgContext();

    const available = await isSupplierCodeAvailableData(
      ctx,
      code,
      excludeSupplierId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to check supplier code",
        "supplier:check-code",
      ),
    };
  }
}

// ============================================
// Supplier Create Operations
// ============================================

/**
 * Create a new supplier
 */
export async function createSupplierFn(
  data: z.infer<typeof createSupplierSchema>
): Promise<ActionResult<Supplier>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createSupplierSchema.parse(data);

    const supplier = await withAutoCode(
      ctx,
      "SUP",
      suppliers,
      suppliers.code,
      undefined,
      (code) =>
        createSupplier(ctx, {
          code,
          name: validated.name,
          location: validated.location || null,
          gpsLatitude: validated.gpsLatitude ?? null,
          gpsLongitude: validated.gpsLongitude ?? null,
          address: validated.address || null,
          contactName: validated.contactName || null,
          contactEmail: validated.contactEmail || null,
          contactPhone: validated.contactPhone || null,
          sourceRegion: validated.sourceRegion || null,
          distanceToFacilityKm: validated.distanceToFacilityKm ?? null,
          distanceSource: resolveDistanceSource(
            validated.distanceToFacilityKm ?? null,
            validated.distanceSource,
          ),
        }),
      CODE_CONFLICT_MESSAGES.supplier,
    );

    return { success: true, data: supplier };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to create supplier",
        "supplier:create",
      ),
    };
  }
}

export async function createSupplierWithLocationsFn(
  data: z.infer<typeof createSupplierWithLocationsSchema>
): Promise<ActionResult<Supplier>> {
  try {
    const ctx = await requireOrgContext();

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
          gpsLatitude: validated.supplier.gpsLatitude ?? null,
          gpsLongitude: validated.supplier.gpsLongitude ?? null,
          address: validated.supplier.address || null,
          contactName: validated.supplier.contactName || null,
          contactEmail: validated.supplier.contactEmail || null,
          contactPhone: validated.supplier.contactPhone || null,
          sourceRegion: validated.supplier.sourceRegion || null,
          distanceToFacilityKm: validated.supplier.distanceToFacilityKm ?? null,
          distanceSource: resolveDistanceSource(
            validated.supplier.distanceToFacilityKm ?? null,
            validated.supplier.distanceSource,
          ),
          locations: validated.locations.map((location) => ({
            name: location.name || null,
            country: location.country,
            stateRegion: location.stateRegion || null,
            city: location.city || null,
            gpsLatitude: location.gpsLatitude,
            gpsLongitude: location.gpsLongitude,
            address: location.address || null,
            distanceFromFacilityKm: location.distanceFromFacilityKm ?? null,
            distanceSource: resolveDistanceSource(
              location.distanceFromFacilityKm ?? null,
              location.distanceSource,
            ),
            isDefault: location.isDefault,
          })),
        })
    );

    return { success: true, data: supplier };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to create supplier",
        "supplier:create-with-locations",
      ),
    };
  }
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
  try {
    const ctx = await requireOrgContext();

    const validated = updateSupplierSchema.parse(data);

    const supplier = await updateSupplier(ctx, validated.supplierId, {
      code: validated.code,
      name: validated.name,
      location: validated.location,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address,
      contactName: validated.contactName,
      contactEmail: validated.contactEmail,
      contactPhone: validated.contactPhone,
      sourceRegion: validated.sourceRegion,
      distanceToFacilityKm: validated.distanceToFacilityKm,
      distanceSource: resolveDistanceSource(
        validated.distanceToFacilityKm,
        validated.distanceSource,
      ),
    });

    return { success: true, data: supplier };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to update supplier",
        "supplier:update",
      ),
    };
  }
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
  try {
    const ctx = await requireOrgContext();

    const validated = deleteSupplierSchema.parse(data);
    await deleteSupplier(ctx, validated.supplierId);

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
      error: supplierActionError(
        error,
        "Failed to delete supplier",
        "supplier:delete",
      ),
    };
  }
}

// ============================================
// Supplier Location Operations
// ============================================

export async function getSupplierLocationsBySupplierFn(
  supplierId: string
): Promise<ActionResult<SupplierLocation[]>> {
  try {
    const ctx = await requireOrgContext();

    const parsed = z.string().uuid("Invalid supplier ID").safeParse(supplierId);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const locations = await getSupplierLocationsBySupplierData(ctx, supplierId);
    return { success: true, data: locations };
  } catch (error) {
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to load supplier locations",
        "supplier-location:list",
      ),
    };
  }
}

export async function createSupplierLocationFn(
  data: z.infer<typeof createSupplierLocationSchema>
): Promise<ActionResult<SupplierLocation>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createSupplierLocationSchema.parse(data);

    const location = await createSupplierLocation(ctx, {
      supplierId: validated.supplierId,
      name: validated.name || null,
      country: validated.country,
      stateRegion: validated.stateRegion || null,
      city: validated.city || null,
      gpsLatitude: validated.gpsLatitude ?? null,
      gpsLongitude: validated.gpsLongitude ?? null,
      address: validated.address || null,
      distanceFromFacilityKm: validated.distanceFromFacilityKm,
      distanceSource: resolveDistanceSource(
        validated.distanceFromFacilityKm ?? null,
        validated.distanceSource,
      ),
      isDefault: validated.isDefault,
    });

    return { success: true, data: location };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to create supplier location",
        "supplier-location:create",
      ),
    };
  }
}

export async function updateSupplierLocationFn(
  data: z.infer<typeof updateSupplierLocationSchema>
): Promise<ActionResult<SupplierLocation>> {
  try {
    const ctx = await requireOrgContext();

    const validated = updateSupplierLocationSchema.parse(data);

    const location = await updateSupplierLocation(ctx, validated.locationId, {
      name: validated.name,
      country: validated.country,
      stateRegion: validated.stateRegion,
      city: validated.city,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address,
      distanceFromFacilityKm: validated.distanceFromFacilityKm,
      distanceSource: resolveDistanceSource(
        validated.distanceFromFacilityKm,
        validated.distanceSource,
      ),
      isDefault: validated.isDefault,
    });

    return { success: true, data: location };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: supplierActionError(
        error,
        "Failed to update supplier location",
        "supplier-location:update",
      ),
    };
  }
}

export async function deleteSupplierLocationFn(
  data: z.infer<typeof deleteSupplierLocationSchema>
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireOrgContext();

    const validated = deleteSupplierLocationSchema.parse(data);
    await deleteSupplierLocation(ctx, validated.locationId);

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
      error: supplierActionError(
        error,
        "Failed to delete supplier location",
        "supplier-location:delete",
      ),
    };
  }
}
