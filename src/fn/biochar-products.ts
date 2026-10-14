"use server";

/**
 * Biochar Products Server Actions
 * Server-side functions for biochar product CRUD operations
 */

import {
  deleteBiocharProduct,
  getBiocharProductById as getBiocharProductByIdData,
  getBiocharProducts as getBiocharProductsData,
  type BiocharProductWithRelations,
  type PaginatedBiocharProducts,
} from "@/data-access/biochar-products";
import type { BiocharProductRecord } from "@/db/schema";
import { z } from "zod";

import { requireOrgFacility } from "@/data-access/utils";
import { deriveSourceBiocharMassKg, toCompositionJsonb } from "@/lib/biochar-composition/composition";
import { SafeError } from "@/lib/errors";
import { makeBiocharProduct, updateBiocharProduct } from "@/lib/operations/biochar-products";
import { runOperationInProcess } from "@/lib/operations/runner";
import {
  biocharProductFilterSchema,
  createBiocharProductSchema,
  deleteBiocharProductSchema,
  updateBiocharProductSchema,
} from "@/schemas/biochar-products";
import { withAction } from "./with-action";
import type { ActionResult } from "@/types/actions";

const LOG_MESSAGE = "biochar product action failed";

const ZERO_SOURCE_BIOCHAR_MESSAGE = "A product requires positive source biochar.";

// ============================================
// Biochar Product List/Query Operations
// ============================================

/**
 * Get paginated list of biochar products with filtering
 */
export async function getBiocharProductsFn(
  filters?: Partial<z.infer<typeof biocharProductFilterSchema>>
): Promise<ActionResult<PaginatedBiocharProducts>> {
  return withAction(async (ctx) => {
    const validatedFilters = filters
      ? biocharProductFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const products = await getBiocharProductsData(ctx, validatedFilters);

    return products;
  }, {
    fallbackMessage: "Failed to load biochar products",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: LOG_MESSAGE, context: { op: "biochar-product:list" } },
  });
}

/**
 * Get a single biochar product by ID
 */
export async function getBiocharProductByIdFn(
  productId: string
): Promise<ActionResult<BiocharProductWithRelations>> {
  return withAction(async (ctx) => {
    const product = await getBiocharProductByIdData(ctx, productId);
    return product;
  }, {
    fallbackMessage: "Failed to load biochar product",
    log: { message: LOG_MESSAGE, context: { op: "biochar-product:get" } },
  });
}

// ============================================
// Biochar Product Create Operations
// ============================================

/**
 * Create a new biochar product through `make_biochar_product`, as the API
 * does. The form submits the pre-water blend; the operation takes the biochar
 * as weighed and derives the same blend again.
 */
export async function createBiocharProductFn(
  data: z.infer<typeof createBiocharProductSchema>
): Promise<ActionResult<BiocharProductRecord>> {
  return withAction(async (ctx) => {
    const validated = createBiocharProductSchema.parse(data);
    const ingredientBins = validated.ingredientBins ?? [];
    const biocharWetMassKg = deriveSourceBiocharMassKg(validated.massKg, ingredientBins);
    if (biocharWetMassKg == null || biocharWetMassKg <= 0) throw new SafeError(ZERO_SOURCE_BIOCHAR_MESSAGE);

    const created = await runOperationInProcess(makeBiocharProduct, ctx, {
      facilityId: validated.facilityId,
      formulationId: validated.formulationId,
      placedAt: validated.placedAt,
      status: validated.status,
      sourceBiocharStorageLocationId: validated.sourceBiocharStorageLocationId,
      storageLocationId: validated.storageLocationId,
      biocharWetMassKg,
      // A split biochar bin is read per sub-bin; its rows replace the one moisture.
      ...(validated.sources ? { sources: validated.sources } : { biocharMoisturePercent: validated.moistureContentPercent ?? null }),
      waterAddedKg: validated.waterAddedKg,
      densityKgM3: validated.densityKgM3 ?? null,
      ingredients: ingredientBins.map((bin) => ({
        formulationIngredientId: bin.formulationIngredientId,
        storageLocationId: bin.storageLocationId ?? null,
        wetMassKg: bin.massKg,
        moisturePercent: bin.moistureContentPercent ?? null,
      })),
      basisFingerprint: validated.basisFingerprint,
      idempotencyKey: validated.idempotencyKey,
    });

    return created.product;
  }, {
    fallbackMessage: "Failed to create biochar product",
    log: { message: LOG_MESSAGE, context: { op: "biochar-product:create" } },
  });
}

// ============================================
// Biochar Product Update Operations
// ============================================

/**
 * Update an existing biochar product through `update_biochar_product`. The
 * form resends the posted facts, so a changed one is refused, not ignored.
 */
export async function updateBiocharProductFn(
  data: z.infer<typeof updateBiocharProductSchema>
): Promise<ActionResult<BiocharProductRecord>> {
  return withAction(async (ctx) => {
    const validated = updateBiocharProductSchema.parse(data);

    const composition = toCompositionJsonb(validated.ingredientBins, { mode: "update" });

    return runOperationInProcess(updateBiocharProduct, ctx, {
      biocharProductId: validated.productId,
      expectedVersion: validated.expectedVersion,
      code: validated.code,
      facilityId: validated.facilityId,
      formulationId: validated.formulationId,
      placedAt: validated.placedAt,
      status: validated.status,
      storageLocationId: validated.storageLocationId,
      massKg: validated.massKg,
      moistureContentPercent: validated.moistureContentPercent,
      densityKgM3: validated.densityKgM3,
      waterAddedKg: validated.waterAddedKg,
      ...(composition !== undefined && { composition }),
    });
  }, {
    fallbackMessage: "Failed to update biochar product",
    log: { message: LOG_MESSAGE, context: { op: "biochar-product:update" } },
  });
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
  return withAction(async (ctx) => {
    const validated = deleteBiocharProductSchema.parse(data);
    await deleteBiocharProduct(ctx, validated.productId, validated.expectedVersion);

    return;
  }, {
    fallbackMessage: "Failed to delete biochar product",
    log: { message: LOG_MESSAGE, context: { op: "biochar-product:delete" } },
  });
}
