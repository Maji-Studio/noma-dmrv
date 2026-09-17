"use server";

/**
 * Production Runs Server Actions
 * Server-side functions for production run CRUD operations
 */

import { z } from "zod";

import { productionRuns } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";

import { requireOrgFacility } from "@/data-access/utils";
import {
  createProductionRun,
  deleteProductionRun,
  getProductionRunById as getProductionRunByIdData,
  getFacilityEnergyTotals as getFacilityEnergyTotalsData,
  getProductionRunReadings as getProductionRunReadingsData,
  updateProductionRun,
  ProductionRunOverlapError,
  ProductionRunDependencyError,
  type ProductionRunWithRelations,
  type FacilityEnergyTotals,
  type ProductionRunReadingRecord,
} from "@/data-access/production-runs";
import {
  createProductionRunSchema,
  deleteProductionRunSchema,
  updateProductionRunSchema,
} from "@/schemas/production-runs";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const LOG_MESSAGE = "production run action failed";

/** Keep the per-operation log context the legacy wrapper emitted. */
function logFor(op: string) {
  return { message: LOG_MESSAGE, context: { op } };
}

/**
 * Domain conflicts this module answers itself. A stale-version refusal is an
 * `ActionConflictError`, which `withAction` formats before consulting this, so
 * the form receives its typed `conflict` and keeps the operator's draft.
 */
function mapProductionRunConflict(error: unknown) {
  if (
    error instanceof ProductionRunOverlapError ||
    error instanceof ProductionRunDependencyError
  ) {
    return { success: false as const, error: error.message, conflict: error.conflict };
  }
  return undefined;
}

// ============================================
// List/Query Operations
// ============================================

/**
 * Get a single production run by ID
 */
export async function getProductionRunByIdFn(
  productionRunId: string
): Promise<ActionResult<ProductionRunWithRelations>> {
  return withAction(
    (ctx) => getProductionRunByIdData(ctx, productionRunId),
    {
      fallbackMessage: "Failed to load production run",
      log: logFor("production-run:get"),
    },
  );
}

/**
 * Get facility-wide electricity + diesel totals (SQL aggregate)
 */
export async function getFacilityEnergyTotalsFn(
  facilityId: string
): Promise<ActionResult<FacilityEnergyTotals>> {
  return withAction(
    async (ctx) => {
      await requireOrgFacility(ctx, facilityId);
      return getFacilityEnergyTotalsData(ctx, facilityId);
    },
    {
      fallbackMessage: "Failed to load facility energy totals",
      log: logFor("production-run:energy-totals"),
    },
  );
}

/**
 * Get production run readings (time-series data)
 */
export async function getProductionRunReadingsFn(
  productionRunId: string
): Promise<ActionResult<ProductionRunReadingRecord[]>> {
  return withAction(
    (ctx) => getProductionRunReadingsData(ctx, productionRunId),
    {
      fallbackMessage: "Failed to load production run readings",
      log: logFor("production-run:readings"),
    },
  );
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
  return withAction(
    async (ctx) => {
      const validated = createProductionRunSchema.parse(data);

      return withAutoCode(
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
            feedstockDraws: validated.feedstockDraws,
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
          }),
        CODE_CONFLICT_MESSAGES.productionRun,
      );
    },
    {
      fallbackMessage: "Failed to create production run",
      log: logFor("production-run:create"),
      mapError: mapProductionRunConflict,
    },
  );
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
  return withAction(
    async (ctx) => {
      const validated = updateProductionRunSchema.parse(data);

      return updateProductionRun(ctx, validated.productionRunId, {
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
        feedstockDraws: validated.feedstockDraws,
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
      });
    },
    {
      fallbackMessage: "Failed to update production run",
      log: logFor("production-run:update"),
      mapError: mapProductionRunConflict,
    },
  );
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
  return withAction(
    async (ctx) => {
      const validated = deleteProductionRunSchema.parse(data);
      await deleteProductionRun(ctx, validated.productionRunId);
    },
    {
      fallbackMessage: "Failed to delete production run",
      log: logFor("production-run:delete"),
      mapError: mapProductionRunConflict,
    },
  );
}
