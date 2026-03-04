"use server";

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
import { getUser } from "@/lib/auth/server";
import {
  createProductionSampleSchema,
  updateProductionSampleSchema,
  deleteProductionSampleSchema,
} from "@/schemas/production-samples";
import type { ActionResult } from "@/types/actions";

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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const samples = await getProductionSamplesData(user.id, productionRunId);
    return { success: true, data: samples };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load production samples",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createProductionSampleSchema.parse(data);

    const sample = await withAutoCode(
      "PS",
      productionSamples,
      productionSamples.sampleCode,
      undefined,
      async (sampleCode) => {
        return createProductionSample(user.id, {
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
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create production sample",
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
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateProductionSampleSchema.parse(data);

    const sample = await updateProductionSample(
      user.id,
      validated.productionSampleId,
      {
        timestamp: new Date(validated.timestamp),
        weightGrams: validated.weightGrams,
        volumeMl: validated.volumeMl,
        temperatureC: validated.temperatureC,
        moistureContentPercent: validated.moistureContentPercent,
        fixedCarbonPercent: validated.fixedCarbonPercent,
        volatileMatterPercent: validated.volatileMatterPercent,
        ashContentPercent: validated.ashContentPercent,
        photoUrl: validated.photoUrl || null,
        sampledById: validated.sampledById,
        notes: validated.notes,
      }
    );

    return { success: true, data: sample };
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
        error instanceof Error
          ? error.message
          : "Failed to update production sample",
    };
  }
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
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteProductionSampleSchema.parse(data);
    await deleteProductionSample(user.id, validated.productionSampleId);

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
        error instanceof Error
          ? error.message
          : "Failed to delete production sample",
    };
  }
}
