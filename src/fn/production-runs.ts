"use server";

/**
 * Production Runs Server Actions
 * Server-side functions for production run CRUD operations
 */

import { z } from "zod";
import { productionRuns } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  createProductionRun,
  deleteProductionRun,
  getProductionRuns as getProductionRunsData,
  getProductionRunById as getProductionRunByIdData,
  getProductionRunStats as getProductionRunStatsData,
  getProductionRunReadings as getProductionRunReadingsData,
  addProductionRunReading as addProductionRunReadingData,
  updateProductionRun,
  isProductionRunCodeAvailable as isProductionRunCodeAvailableData,
  type PaginatedProductionRuns,
  type ProductionRunWithRelations,
  type ProductionRunStats,
  type ProductionRunReadingRecord,
} from "@/data-access/production-runs";
import { getUser } from "@/lib/auth/server";
import {
  createProductionRunSchema,
  deleteProductionRunSchema,
  updateProductionRunSchema,
  productionRunFilterSchema,
  productionRunReadingSchema,
} from "@/schemas/production-runs";
import type { ActionResult } from "@/types/actions";

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of production runs with filtering
 */
export async function getProductionRunsFn(
  filters?: Partial<z.infer<typeof productionRunFilterSchema>>
): Promise<ActionResult<PaginatedProductionRuns>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? productionRunFilterSchema.parse(filters)
      : undefined;
    const runs = await getProductionRunsData(user.id, validatedFilters);

    return { success: true, data: runs };
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
        error instanceof Error ? error.message : "Failed to load production runs",
    };
  }
}

/**
 * Get a single production run by ID
 */
export async function getProductionRunByIdFn(
  productionRunId: string
): Promise<ActionResult<ProductionRunWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const run = await getProductionRunByIdData(user.id, productionRunId);
    return { success: true, data: run };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load production run",
    };
  }
}

/**
 * Get production run statistics
 */
export async function getProductionRunStatsFn(
  facilityId?: string
): Promise<ActionResult<ProductionRunStats>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const stats = await getProductionRunStatsData(user.id, facilityId);
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load production run stats",
    };
  }
}

/**
 * Get production run readings (time-series data)
 */
export async function getProductionRunReadingsFn(
  productionRunId: string
): Promise<ActionResult<ProductionRunReadingRecord[]>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const readings = await getProductionRunReadingsData(user.id, productionRunId);
    return { success: true, data: readings };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load production run readings",
    };
  }
}

/**
 * Check if a production run code is available
 */
export async function checkProductionRunCodeFn(
  code: string,
  excludeRunId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isProductionRunCodeAvailableData(
      user.id,
      code,
      excludeRunId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check production run code",
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new production run
 */
export async function createProductionRunFn(
  data: z.infer<typeof createProductionRunSchema>
): Promise<ActionResult<ProductionRunWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createProductionRunSchema.parse(data);

    const run = await withAutoCode(
      "PR",
      productionRuns,
      productionRuns.code,
      validated.code,
      (code) =>
        createProductionRun(user.id, {
          code,
          facilityId: validated.facilityId,
          date: validated.date instanceof Date ? validated.date : new Date(validated.date),
          reactorId: validated.reactorId,
          status: validated.status,
          startTime: validated.startTime instanceof Date ? validated.startTime : new Date(validated.startTime),
          endTime: validated.endTime instanceof Date ? validated.endTime : new Date(validated.endTime),
          operatorId: validated.operatorId || null,
          feedstockMassUsedKg: validated.feedstockMassUsedKg ?? null,
          feedingRateKgHr: validated.feedingRateKgHr ?? null,
          residenceTimeMinutes: validated.residenceTimeMinutes ?? null,
          dieselOperationLiters: validated.dieselOperationLiters ?? null,
          dieselGensetLiters: validated.dieselGensetLiters ?? null,
          preprocessingFuelLiters: validated.preprocessingFuelLiters ?? null,
          electricityKwh: validated.electricityKwh ?? null,
          biocharOutputKg: validated.biocharOutputKg ?? null,
          biocharStorageLocationId: validated.biocharStorageLocationId || null,
          feedstockStorageLocationId: validated.feedstockStorageLocationId || null,
          plcDataFileUrl: validated.plcDataFileUrl || null,
        })
    );

    return { success: true, data: run };
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
        error instanceof Error ? error.message : "Failed to create production run",
    };
  }
}

/**
 * Add a reading to a production run
 */
export async function addProductionRunReadingFn(
  data: z.infer<typeof productionRunReadingSchema>
): Promise<ActionResult<ProductionRunReadingRecord>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = productionRunReadingSchema.parse(data);

    const reading = await addProductionRunReadingData(user.id, {
      productionRunId: validated.productionRunId,
      timestamp: validated.timestamp instanceof Date ? validated.timestamp : new Date(validated.timestamp),
      temperatureC: validated.temperatureC ?? null,
      pressureBar: validated.pressureBar ?? null,
      gasFlowRate: validated.gasFlowRate ?? null,
    });

    return { success: true, data: reading };
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
        error instanceof Error ? error.message : "Failed to add reading",
    };
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing production run
 */
export async function updateProductionRunFn(
  data: z.infer<typeof updateProductionRunSchema>
): Promise<ActionResult<ProductionRunWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateProductionRunSchema.parse(data);

    const run = await updateProductionRun(user.id, validated.productionRunId, {
      code: validated.code,
      facilityId: validated.facilityId,
      date: validated.date instanceof Date ? validated.date : validated.date ? new Date(validated.date) : undefined,
      reactorId: validated.reactorId,
      status: validated.status,
      startTime: validated.startTime instanceof Date ? validated.startTime : validated.startTime ? new Date(validated.startTime) : undefined,
      endTime: validated.endTime instanceof Date ? validated.endTime : validated.endTime ? new Date(validated.endTime) : undefined,
      operatorId: validated.operatorId,
      feedstockMassUsedKg: validated.feedstockMassUsedKg,
      feedingRateKgHr: validated.feedingRateKgHr,
      residenceTimeMinutes: validated.residenceTimeMinutes,
      dieselOperationLiters: validated.dieselOperationLiters,
      dieselGensetLiters: validated.dieselGensetLiters,
      preprocessingFuelLiters: validated.preprocessingFuelLiters,
      electricityKwh: validated.electricityKwh,
      biocharOutputKg: validated.biocharOutputKg,
      biocharStorageLocationId: validated.biocharStorageLocationId,
      feedstockStorageLocationId: validated.feedstockStorageLocationId,
      plcDataFileUrl: validated.plcDataFileUrl,
    });

    return { success: true, data: run };
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
        error instanceof Error ? error.message : "Failed to update production run",
    };
  }
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a production run
 */
export async function deleteProductionRunFn(
  data: z.infer<typeof deleteProductionRunSchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteProductionRunSchema.parse(data);
    await deleteProductionRun(user.id, validated.productionRunId);

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
        error instanceof Error ? error.message : "Failed to delete production run",
    };
  }
}
