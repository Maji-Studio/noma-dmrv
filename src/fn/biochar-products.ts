"use server";

/**
 * Biochar Products Server Actions
 * Server-side functions for biochar product CRUD operations
 */

import { z } from "zod";
import type { BiocharProduct } from "@/db/schema";
import {
  createBiocharProduct,
  deleteBiocharProduct,
  getBiocharProducts as getBiocharProductsData,
  getBiocharProductById as getBiocharProductByIdData,
  isBiocharProductCodeAvailable as isBiocharProductCodeAvailableData,
  getBiocharProductOptions as getBiocharProductOptionsData,
  updateBiocharProduct,
  type PaginatedBiocharProducts,
  type BiocharProductWithRelations,
} from "@/data-access/biochar-products";
import { getUser } from "@/lib/auth/server";
import {
  createBiocharProductSchema,
  deleteBiocharProductSchema,
  updateBiocharProductSchema,
  biocharProductFilterSchema,
} from "@/schemas/biochar-products";
import type { ActionResult } from "@/types/actions";
import { withAutoCode } from "@/data-access/code-generator";
import { biocharProducts } from "@/db/schema";

// ============================================
// Biochar Product List/Query Operations
// ============================================

/**
 * Get paginated list of biochar products with filtering
 */
export async function getBiocharProductsFn(
  filters?: Partial<z.infer<typeof biocharProductFilterSchema>>
): Promise<ActionResult<PaginatedBiocharProducts>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? biocharProductFilterSchema.parse(filters)
      : undefined;
    const products = await getBiocharProductsData(user.id, validatedFilters);

    return { success: true, data: products };
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
        error instanceof Error ? error.message : "Failed to load biochar products",
    };
  }
}

/**
 * Get a single biochar product by ID
 */
export async function getBiocharProductByIdFn(
  productId: string
): Promise<ActionResult<BiocharProductWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const product = await getBiocharProductByIdData(user.id, productId);
    return { success: true, data: product };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load biochar product",
    };
  }
}

/**
 * Get biochar product options for dropdowns
 */
export async function getBiocharProductOptionsFn(): Promise<
  ActionResult<Array<{ id: string; code: string }>>
> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const options = await getBiocharProductOptionsData(user.id);
    return { success: true, data: options };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load biochar product options",
    };
  }
}

/**
 * Check if a biochar product code is available
 */
export async function checkBiocharProductCodeFn(
  code: string,
  excludeProductId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isBiocharProductCodeAvailableData(
      user.id,
      code,
      excludeProductId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check biochar product code",
    };
  }
}

// ============================================
// Biochar Product Create Operations
// ============================================

/**
 * Create a new biochar product
 */
export async function createBiocharProductFn(
  data: z.infer<typeof createBiocharProductSchema>
): Promise<ActionResult<BiocharProduct>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createBiocharProductSchema.parse(data);

    const product = await withAutoCode(
      "BP",
      biocharProducts,
      biocharProducts.code,
      undefined,
      (code) =>
        createBiocharProduct(user.id, {
          code,
          facilityId: validated.facilityId,
          formulationId: validated.formulationId,
          productionDate: validated.productionDate,
          status: validated.status,
          linkedProductionRunId: validated.linkedProductionRunId || null,
          storageLocationId: validated.storageLocationId || null,
          massKg: validated.massKg ?? null,
          moistureContentPercent: validated.moistureContentPercent ?? null,
          densityKgM3: validated.densityKgM3 ?? null,
          waterAddedKg: validated.waterAddedKg ?? null,
        })
    );

    return { success: true, data: product };
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
        error instanceof Error ? error.message : "Failed to create biochar product",
    };
  }
}

// ============================================
// Biochar Product Update Operations
// ============================================

/**
 * Update an existing biochar product
 */
export async function updateBiocharProductFn(
  data: z.infer<typeof updateBiocharProductSchema>
): Promise<ActionResult<BiocharProduct>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateBiocharProductSchema.parse(data);

    const product = await updateBiocharProduct(user.id, validated.productId, {
      code: validated.code,
      facilityId: validated.facilityId,
      formulationId: validated.formulationId,
      productionDate: validated.productionDate,
      status: validated.status,
      linkedProductionRunId: validated.linkedProductionRunId === "" ? null : validated.linkedProductionRunId,
      storageLocationId: validated.storageLocationId === "" ? null : validated.storageLocationId,
      massKg: validated.massKg,
      moistureContentPercent: validated.moistureContentPercent,
      densityKgM3: validated.densityKgM3,
      waterAddedKg: validated.waterAddedKg,
    });

    return { success: true, data: product };
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
        error instanceof Error ? error.message : "Failed to update biochar product",
    };
  }
}

// ============================================
// Biochar Product Delete Operations
// ============================================

/**
 * Delete a biochar product
 */
export async function deleteBiocharProductFn(
  data: z.infer<typeof deleteBiocharProductSchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteBiocharProductSchema.parse(data);
    await deleteBiocharProduct(user.id, validated.productId);

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
        error instanceof Error ? error.message : "Failed to delete biochar product",
    };
  }
}
