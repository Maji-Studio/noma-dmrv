"use server";

/**
 * Suppliers Server Actions
 * Server-side functions for supplier CRUD operations
 */

import { z } from "zod";
import { type Supplier, type SupplierLocation, suppliers } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  createSupplier,
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
import { getUser } from "@/lib/auth/server";
import {
  createSupplierSchema,
  deleteSupplierSchema,
  updateSupplierSchema,
  supplierFilterSchema,
  createSupplierLocationSchema,
  updateSupplierLocationSchema,
  deleteSupplierLocationSchema,
} from "@/schemas/suppliers";
import type { ActionResult } from "@/types/actions";

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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? supplierFilterSchema.parse(filters)
      : undefined;
    const suppliers = await getSuppliersData(user.id, validatedFilters);

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
      error:
        error instanceof Error ? error.message : "Failed to load suppliers",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const supplier = await getSupplierByIdData(user.id, supplierId);
    return { success: true, data: supplier };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load supplier",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const locations = await getSupplierLocationsData(user.id);
    return { success: true, data: locations };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load locations",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const options = await getSupplierOptionsData(user.id);
    return { success: true, data: options };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load supplier options",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isSupplierCodeAvailableData(
      user.id,
      code,
      excludeSupplierId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check supplier code",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createSupplierSchema.parse(data);

    const supplier = await withAutoCode(
      "SUP",
      suppliers,
      suppliers.code,
      undefined,
      (code) =>
        createSupplier(user.id, {
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
      error:
        error instanceof Error ? error.message : "Failed to create supplier",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateSupplierSchema.parse(data);

    const supplier = await updateSupplier(user.id, validated.supplierId, {
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
      error:
        error instanceof Error ? error.message : "Failed to update supplier",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteSupplierSchema.parse(data);
    await deleteSupplier(user.id, validated.supplierId);

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
        error instanceof Error ? error.message : "Failed to delete supplier",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const parsed = z.string().uuid("Invalid supplier ID").safeParse(supplierId);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const locations = await getSupplierLocationsBySupplierData(user.id, supplierId);
    return { success: true, data: locations };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load supplier locations",
    };
  }
}

export async function createSupplierLocationFn(
  data: z.infer<typeof createSupplierLocationSchema>
): Promise<ActionResult<SupplierLocation>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createSupplierLocationSchema.parse(data);

    const location = await createSupplierLocation(user.id, {
      supplierId: validated.supplierId,
      name: validated.name || null,
      country: validated.country,
      stateRegion: validated.stateRegion || null,
      city: validated.city || null,
      gpsLatitude: validated.gpsLatitude ?? null,
      gpsLongitude: validated.gpsLongitude ?? null,
      address: validated.address || null,
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
      error: error instanceof Error ? error.message : "Failed to create supplier location",
    };
  }
}

export async function updateSupplierLocationFn(
  data: z.infer<typeof updateSupplierLocationSchema>
): Promise<ActionResult<SupplierLocation>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateSupplierLocationSchema.parse(data);

    const location = await updateSupplierLocation(user.id, validated.locationId, {
      name: validated.name,
      country: validated.country,
      stateRegion: validated.stateRegion,
      city: validated.city,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address,
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
      error: error instanceof Error ? error.message : "Failed to update supplier location",
    };
  }
}

export async function deleteSupplierLocationFn(
  data: z.infer<typeof deleteSupplierLocationSchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteSupplierLocationSchema.parse(data);
    await deleteSupplierLocation(user.id, validated.locationId);

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
      error: error instanceof Error ? error.message : "Failed to delete supplier location",
    };
  }
}
