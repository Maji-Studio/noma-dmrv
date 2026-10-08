"use server";
import { withAction } from "./with-action";

/**
 * Production Samples Server Actions
 * Server-side functions for in-process sample CRUD operations
 */

import { z } from "zod";
import { productionSamples } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  getProductionSamples as getProductionSamplesData,
  createProductionSample,
  updateProductionSample,
  deleteProductionSample,
  type ProductionSampleWithRelations,
} from "@/data-access/production-samples";
import { requireOrgContext } from "@/lib/auth/server";
import {
  createProductionSampleSchema,
  updateProductionSampleSchema,
  deleteProductionSampleSchema,
} from "@/schemas/production-samples";
import type { ActionResult } from "@/types/actions";
import { formatZodActionError } from "./action-errors";

const productionRunIdSchema = z.string().uuid("Production run is required");

function logServerError(context: string, error: unknown): void {
  console.error(`[production-samples] ${context}`, error);
}

// ============================================
// List Operations
// ============================================

/**
 * Get all production samples for a production run
 */
export async function getProductionSamplesFn(
  productionRunId: string
): Promise<ActionResult<ProductionSampleWithRelations[]>> {
  try {
    const ctx = await requireOrgContext();

    const validatedProductionRunId = productionRunIdSchema.safeParse(productionRunId);
    if (!validatedProductionRunId.success) {
      return { success: false, error: "Invalid input" };
    }

    const samples = await getProductionSamplesData(ctx, validatedProductionRunId.data);
    return { success: true, data: samples };
  } catch (error) {
    logServerError("getProductionSamplesFn failed", error);
    return {
      success: false,
      error:
        "In-process measurements could not be loaded. Refresh the page and try again.",
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new production sample with auto-generated sample code
 */
export async function createProductionSampleFn(
  data: z.infer<typeof createProductionSampleSchema>
): Promise<ActionResult<ProductionSampleWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createProductionSampleSchema.parse(data);

    const sample = await withAutoCode(
      ctx,
      "PS",
      productionSamples,
      productionSamples.sampleCode,
      undefined,
      async (sampleCode) => {
        return createProductionSample(ctx, {
          sampleCode,
          productionRunId: validated.productionRunId,
          timestamp: new Date(validated.timestamp),
          weightGrams: validated.weightGrams ?? null,
          volumeMl: validated.volumeMl ?? null,
          temperatureC: validated.temperatureC ?? null,
          moistureContentPercent: validated.moistureContentPercent ?? null,
          fixedCarbonPercent: validated.fixedCarbonPercent ?? null,
          volatileMatterPercent: validated.volatileMatterPercent ?? null,
          ashContentPercent: validated.ashContentPercent ?? null,
          photoUrl: validated.photoUrl || null,
          sampledById: validated.sampledById ?? null,
          notes: validated.notes ?? null,
        });
      }
    );

    return { success: true, data: sample };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    logServerError("createProductionSampleFn failed", error);
    return {
      success: false,
      error:
        "In-process measurement was not created. Check the form.",
    };
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing production sample
 */
export async function updateProductionSampleFn(
  data: z.infer<typeof updateProductionSampleSchema>
): Promise<ActionResult<ProductionSampleWithRelations>> {
  return withAction(async (ctx) => {
    const validated = updateProductionSampleSchema.parse(data);

    const sample = await updateProductionSample(
      ctx,
      validated.productionSampleId,
      {
        expectedVersion: validated.expectedVersion,
        timestamp: new Date(validated.timestamp),
        weightGrams: validated.weightGrams,
        volumeMl: validated.volumeMl,
        temperatureC: validated.temperatureC,
        moistureContentPercent: validated.moistureContentPercent,
        fixedCarbonPercent: validated.fixedCarbonPercent,
        volatileMatterPercent: validated.volatileMatterPercent,
        ashContentPercent: validated.ashContentPercent,
        photoUrl: validated.photoUrl || null,
        sampledById: validated.sampledById ?? null,
        notes: validated.notes ?? null,
      }
    );

    return sample;
  }, {
    fallbackMessage: "In-process measurement was not saved. Try again.",
    log: { message: "updateProductionSampleFn failed" },
  });
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a production sample
 */
export async function deleteProductionSampleFn(
  data: z.infer<typeof deleteProductionSampleSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {
    const validated = deleteProductionSampleSchema.parse(data);
    await deleteProductionSample(ctx, validated.productionSampleId, validated.expectedVersion);

    return;
  }, {
    fallbackMessage: "In-process measurement was not deleted. Try again.",
    log: { message: "deleteProductionSampleFn failed" },
  });
}
