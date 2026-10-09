"use server";

/**
 * Production Runs Server Actions
 * Server-side functions for production run CRUD operations
 */

import { z } from "zod";

import {
  getProductionRunById as getProductionRunByIdData,
  getProductionRunReadings as getProductionRunReadingsData,
  type ProductionRunWithRelations,
  type ProductionRunReadingRecord,
} from "@/data-access/production-runs";
import {
  createProductionRunSchema,
  deleteProductionRunSchema,
  updateProductionRunSchema,
} from "@/schemas/production-runs";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

import { startProductionRun, updateProductionRun, deleteProductionRun } from "@/lib/operations/production-runs";
import { runOperationInProcess } from "@/lib/operations/runner";

const LOG_MESSAGE = "production run action failed";

/** Keep the per-operation log context the legacy wrapper emitted. */
function logFor(op: string) {
  return { message: LOG_MESSAGE, context: { op } };
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
    (ctx) => {
      const { startDate, endDate, feedstockWetMassKg, feedstockStorageLocationId, ...input } = createProductionRunSchema.parse(data);
      void startDate; void endDate; void feedstockWetMassKg; void feedstockStorageLocationId;
      return runOperationInProcess(startProductionRun, ctx, input);
    },
    {
      fallbackMessage: "Failed to create production run",
      log: logFor("production-run:create"),
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
    (ctx) => {
      const { feedstockWetMassKg, feedstockStorageLocationId, ...input } = updateProductionRunSchema.parse(data);
      void feedstockWetMassKg; void feedstockStorageLocationId;
      return runOperationInProcess(updateProductionRun, ctx, input);
    },
    {
      fallbackMessage: "Failed to update production run",
      log: logFor("production-run:update"),
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
    (ctx) => runOperationInProcess(deleteProductionRun, ctx, deleteProductionRunSchema.parse(data)),
    {
      fallbackMessage: "Failed to delete production run",
      log: logFor("production-run:delete"),
    },
  );
}
