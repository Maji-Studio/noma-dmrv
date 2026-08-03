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
  updateBiocharProduct,
  type PaginatedBiocharProducts,
  type BiocharProductWithRelations,
} from "@/data-access/biochar-products";
import {
  isBiocharProductCodeAvailable as isBiocharProductCodeAvailableData,
  getBiocharProductOptions as getBiocharProductOptionsData,
} from "@/data-access/biochar-product-lookups";
import { requireOrgContext } from "@/lib/auth/server";
import {
  createBiocharProductSchema,
  deleteBiocharProductSchema,
  updateBiocharProductSchema,
  biocharProductFilterSchema,
} from "@/schemas/biochar-products";
import type { ActionResult } from "@/types/actions";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import { requireOrgFacility } from "@/data-access/utils";
import { biocharProducts } from "@/db/schema";
import { toCompositionJsonb } from "@/lib/biochar-composition/composition";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";

function biocharProductActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "biochar product action failed",
    context: { op },
  });
}

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
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? biocharProductFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const products = await getBiocharProductsData(ctx, validatedFilters);

    return { success: true, data: products };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error, "Invalid filter parameters"),
      };
    }
    return {
      success: false,
      error: biocharProductActionError(
        error,
        "Failed to load biochar products",
        "biochar-product:list",
      ),
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
    const ctx = await requireOrgContext();

    const product = await getBiocharProductByIdData(ctx, productId);
    return { success: true, data: product };
  } catch (error) {
    return {
      success: false,
      error: biocharProductActionError(
        error,
        "Failed to load biochar product",
        "biochar-product:get",
      ),
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
    const ctx = await requireOrgContext();

    const options = await getBiocharProductOptionsData(ctx);
    return { success: true, data: options };
  } catch (error) {
    return {
      success: false,
      error: biocharProductActionError(
        error,
        "Failed to load biochar product options",
        "biochar-product:options",
      ),
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
    const ctx = await requireOrgContext();

    const available = await isBiocharProductCodeAvailableData(
      ctx,
      code,
      excludeProductId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: biocharProductActionError(
        error,
        "Failed to check biochar product code",
        "biochar-product:check-code",
      ),
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
    const ctx = await requireOrgContext();

    const validated = createBiocharProductSchema.parse(data);

    const composition = toCompositionJsonb(validated.ingredientBins, { mode: "create" });

    const product = await withAutoCode(
      ctx,
      "BP",
      biocharProducts,
      biocharProducts.code,
      undefined,
      (code) =>
        createBiocharProduct(ctx, {
          code,
          facilityId: validated.facilityId,
          formulationId: validated.formulationId ?? null,
          status: validated.status,
          sourceBiocharStorageLocationId:
            validated.sourceBiocharStorageLocationId,
          storageLocationId: validated.storageLocationId || null,
          massKg: validated.massKg ?? null,
          moistureContentPercent: validated.moistureContentPercent ?? null,
          densityKgM3: validated.densityKgM3 ?? null,
          waterAddedKg: validated.waterAddedKg ?? null,
          composition,
        }),
      CODE_CONFLICT_MESSAGES.biocharProduct,
    );

    return { success: true, data: product };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: biocharProductActionError(
        error,
        "Failed to create biochar product",
        "biochar-product:create",
      ),
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
    const ctx = await requireOrgContext();

    const validated = updateBiocharProductSchema.parse(data);

    const composition = toCompositionJsonb(validated.ingredientBins, { mode: "update" });

    const product = await updateBiocharProduct(ctx, validated.productId, {
      code: validated.code,
      facilityId: validated.facilityId,
      formulationId: validated.formulationId,
      status: validated.status,
      storageLocationId: validated.storageLocationId === "" ? null : validated.storageLocationId,
      massKg: validated.massKg,
      moistureContentPercent: validated.moistureContentPercent,
      densityKgM3: validated.densityKgM3,
      waterAddedKg: validated.waterAddedKg,
      ...(composition !== undefined && { composition }),
    });

    return { success: true, data: product };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: biocharProductActionError(
        error,
        "Failed to update biochar product",
        "biochar-product:update",
      ),
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
    const ctx = await requireOrgContext();

    const validated = deleteBiocharProductSchema.parse(data);
    await deleteBiocharProduct(ctx, validated.productId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: biocharProductActionError(
        error,
        "Failed to delete biochar product",
        "biochar-product:delete",
      ),
    };
  }
}
