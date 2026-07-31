"use server";

/**
 * Production Runs Server Actions
 * Server-side functions for production run CRUD operations
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { productionRuns, storageLocations } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import { db } from "@/db";
import { requireOrgFacility } from "@/data-access/utils";
import {
  createProductionRun,
  deleteProductionRun,
  getProductionRuns as getProductionRunsData,
  getProductionRunById as getProductionRunByIdData,
  getProductionRunStats as getProductionRunStatsData,
  getFacilityEnergyTotals as getFacilityEnergyTotalsData,
  getProductionRunReadings as getProductionRunReadingsData,
  updateProductionRun,
  isProductionRunCodeAvailable as isProductionRunCodeAvailableData,
  ProductionRunOverlapError,
  ProductionRunDependencyError,
  productionRunDateExpr,
  type PaginatedProductionRuns,
  type ProductionRunWithRelations,
  type ProductionRunStats,
  type FacilityEnergyTotals,
  type ProductionRunReadingRecord,
} from "@/data-access/production-runs";
import { requireOrgContext } from "@/lib/auth/server";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";
import {
  createProductionRunSchema,
  deleteProductionRunSchema,
  updateProductionRunSchema,
  productionRunFilterSchema,
} from "@/schemas/production-runs";
import type { ActionResult } from "@/types/actions";

function productionRunActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "production run action failed",
    context: { op },
  });
}

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
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? productionRunFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const runs = await getProductionRunsData(ctx, validatedFilters);

    return { success: true, data: runs };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error, "Invalid filter parameters"),
      };
    }
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to load production runs",
        "production-run:list",
      ),
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
    const ctx = await requireOrgContext();

    const run = await getProductionRunByIdData(ctx, productionRunId);
    return { success: true, data: run };
  } catch (error) {
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to load production run",
        "production-run:get",
      ),
    };
  }
}

export async function getProductionRunBiocharPreviewFn(
  productionRunId: string
): Promise<
  ActionResult<{
    date: string;
    biocharOutputKg: number | null;
    biocharStorageLocationCode: string | null;
  }>
> {
  try {
    const ctx = await requireOrgContext();

    const [run] = await db
      .select({
        date: productionRunDateExpr(),
        biocharOutputKg: productionRuns.biocharOutputKg,
        biocharStorageLocationCode: storageLocations.code,
      })
      .from(productionRuns)
      .leftJoin(storageLocations, and(eq(productionRuns.biocharStorageLocationId, storageLocations.id), eq(storageLocations.organizationId, ctx.organizationId)))
      .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
      .limit(1);

    if (!run) {
      return { success: false, error: "Production run not found" };
    }

    return { success: true, data: run };
  } catch (error) {
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to load production run preview",
        "production-run:preview",
      ),
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
    const ctx = await requireOrgContext();

    if (facilityId) {
      await requireOrgFacility(ctx, facilityId);
    }
    const stats = await getProductionRunStatsData(ctx, facilityId);
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to load production run stats",
        "production-run:stats",
      ),
    };
  }
}

/**
 * Get facility-wide electricity + diesel totals (SQL aggregate)
 */
export async function getFacilityEnergyTotalsFn(
  facilityId: string
): Promise<ActionResult<FacilityEnergyTotals>> {
  try {
    const ctx = await requireOrgContext();

    await requireOrgFacility(ctx, facilityId);
    const totals = await getFacilityEnergyTotalsData(ctx, facilityId);
    return { success: true, data: totals };
  } catch (error) {
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to load facility energy totals",
        "production-run:energy-totals",
      ),
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
    const ctx = await requireOrgContext();

    const readings = await getProductionRunReadingsData(ctx, productionRunId);
    return { success: true, data: readings };
  } catch (error) {
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to load production run readings",
        "production-run:readings",
      ),
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
    const ctx = await requireOrgContext();

    const available = await isProductionRunCodeAvailableData(
      ctx,
      code,
      excludeRunId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to check production run code",
        "production-run:check-code",
      ),
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
    const ctx = await requireOrgContext();

    const validated = createProductionRunSchema.parse(data);

    const run = await withAutoCode(
      ctx,
      "PR",
      productionRuns,
      productionRuns.code,
      undefined,
      (code) =>
        createProductionRun(ctx, {
          code,
          facilityId: validated.facilityId,
          reactorId: validated.reactorId,
          status: validated.status,
          cancellationReason: validated.cancellationReason || null,
          startTime: validated.startTime instanceof Date ? validated.startTime : new Date(validated.startTime),
          // Absent end time now stores NULL (an open run) — no silent coercion
          // to startTime, which produced misleading zero-duration windows (#259).
          endTime: validated.endTime instanceof Date ? validated.endTime : null,
          operatorId: validated.operatorId || null,
          feedstockWetMassKg: validated.feedstockWetMassKg ?? null,
          feedstockMoisturePercent: validated.feedstockMoisturePercent ?? null,
          feedingRateKgHr: validated.feedingRateKgHr ?? null,
          residenceTimeMinutes: validated.residenceTimeMinutes ?? null,
          dieselOperationLiters: validated.dieselOperationLiters ?? null,
          dieselGensetLiters: validated.dieselGensetLiters ?? null,
          preprocessingFuelLiters: validated.preprocessingFuelLiters ?? null,
          electricityKwh: validated.electricityKwh ?? null,
          biocharOutputKg: validated.biocharOutputKg ?? null,
          biocharMoisturePercent: validated.biocharMoisturePercent ?? null,
          biocharStorageLocationId: validated.biocharStorageLocationId || null,
          feedstockStorageLocationId: validated.feedstockStorageLocationId || null,
        }),
      CODE_CONFLICT_MESSAGES.productionRun,
    );

    return { success: true, data: run };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    if (error instanceof ProductionRunOverlapError) {
      return { success: false, error: error.message, conflict: error.conflict };
    }
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to create production run",
        "production-run:create",
      ),
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
    const ctx = await requireOrgContext();

    const validated = updateProductionRunSchema.parse(data);

    const run = await updateProductionRun(ctx, validated.productionRunId, {
      code: validated.code,
      facilityId: validated.facilityId,
      reactorId: validated.reactorId,
      status: validated.status,
      expectedUpdatedAt: validated.expectedUpdatedAt,
      cancellationReason: validated.cancellationReason,
      startTime: validated.startTime instanceof Date ? validated.startTime : validated.startTime ? new Date(validated.startTime) : undefined,
      // null clears the end time; undefined leaves it unchanged.
      endTime:
        validated.endTime === null
          ? null
          : validated.endTime instanceof Date
            ? validated.endTime
            : validated.endTime
              ? new Date(validated.endTime)
              : undefined,
      operatorId: validated.operatorId,
      feedstockWetMassKg: validated.feedstockWetMassKg,
      feedstockMoisturePercent: validated.feedstockMoisturePercent,
      feedingRateKgHr: validated.feedingRateKgHr,
      residenceTimeMinutes: validated.residenceTimeMinutes,
      dieselOperationLiters: validated.dieselOperationLiters,
      dieselGensetLiters: validated.dieselGensetLiters,
      preprocessingFuelLiters: validated.preprocessingFuelLiters,
      electricityKwh: validated.electricityKwh,
      biocharOutputKg: validated.biocharOutputKg,
      biocharMoisturePercent: validated.biocharMoisturePercent,
      biocharStorageLocationId: validated.biocharStorageLocationId,
      feedstockStorageLocationId: validated.feedstockStorageLocationId,
    });

    return { success: true, data: run };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    if (error instanceof ProductionRunOverlapError) {
      return { success: false, error: error.message, conflict: error.conflict };
    }
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to update production run",
        "production-run:update",
      ),
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
    const ctx = await requireOrgContext();

    const validated = deleteProductionRunSchema.parse(data);
    await deleteProductionRun(ctx, validated.productionRunId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    if (error instanceof ProductionRunDependencyError) {
      return { success: false, error: error.message, conflict: error.conflict };
    }
    return {
      success: false,
      error: productionRunActionError(
        error,
        "Failed to delete production run",
        "production-run:delete",
      ),
    };
  }
}
