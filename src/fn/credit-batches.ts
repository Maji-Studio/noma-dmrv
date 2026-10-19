"use server";

import { withAction } from "./with-action";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { SafeError } from "@/lib/errors";
import { creditBatches } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import { requireOrgFacility } from "@/data-access/utils";
import {
  getCreditBatchById,
  getCo2eStoredPreviews as getCo2eStoredPreviewsData,
  getCreditBatchProductionRunOptions,
  getCreditBatchCertifierForFacility,
  createCreditBatch as createCreditBatchData,
  updateCreditBatch as updateCreditBatchData,
  deleteCreditBatch as deleteCreditBatchData,
  creditBatchCodeExists,
  type CreditBatchWithRelations,
  type SavedCreditBatch,
  type CreditBatchCo2eStoredPreview,
  type CreditBatchProductionRunOption,
} from "@/data-access/credit-batches";
import {
  createCreditBatchSchema,
  creditBatchFormSchemaForCertifier,
  updateCreditBatchSchema,
  deleteCreditBatchSchema,
} from "@/schemas/credit-batches";
import { SAVED_DETAILS_UNAVAILABLE } from "@/lib/copy-utils";

class CreditBatchNotFoundError extends SafeError {}

const MAX_BATCH_PREVIEWS = 50;
const CREDIT_BATCH_NOT_FOUND = "Credit batch not found";
const creditBatchFacilitySchema = z.object({
  facilityId: createCreditBatchSchema.shape.facilityId,
});

/**
 * Get credit batch by ID
 */
export async function getCreditBatchByIdFn(
  id: string
): Promise<ActionResult<CreditBatchWithRelations>> {
  return withAction(async (ctx) => {
    const creditBatch = await getCreditBatchById(ctx, id);
    if (!creditBatch) {
      throw new CreditBatchNotFoundError(CREDIT_BATCH_NOT_FOUND);
    }

    return creditBatch;
  }, {
    fallbackMessage: "Failed to get credit batch",
    log: { message: "Failed to get credit batch", context: { op: "credit-batch:get" } },
    mapError: (error) =>
      error instanceof CreditBatchNotFoundError
        ? { success: false as const, error: CREDIT_BATCH_NOT_FOUND }
        : undefined,
  });
}

export async function getCo2eStoredPreviewsFn(
  batchIds: string[]
): Promise<ActionResult<Record<string, CreditBatchCo2eStoredPreview>>> {
  return withAction(async (ctx) => {
    const ids = z
      .array(z.string().uuid())
      .max(
        MAX_BATCH_PREVIEWS,
        `Select at most ${MAX_BATCH_PREVIEWS} credit batches for preview`,
      )
      .parse(batchIds);
    const previews = await getCo2eStoredPreviewsData(ctx, ids);
    return previews;
  }, {
    fallbackMessage: "Failed to get CO2e stored previews",
    log: { message: "Failed to get CO2e stored previews", context: { op: "credit-batch:co2e-previews" } },
  });
}

const creditBatchProductionRunOptionsSchema = z.object({
  facilityId: z.string().uuid(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  includeCreditBatchId: z.string().uuid().optional().nullable(),
});

export async function getCreditBatchProductionRunOptionsFn(
  input: {
    facilityId: string;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    includeCreditBatchId?: string | null;
  },
): Promise<ActionResult<CreditBatchProductionRunOption[]>> {
  return withAction(async (ctx) => {
    const validated = creditBatchProductionRunOptionsSchema.parse(input);
    await requireOrgFacility(ctx, validated.facilityId);
    const options = await getCreditBatchProductionRunOptions(
      ctx,
      validated,
    );
    return options;
  }, {
    fallbackMessage: "Failed to get credit batch production run options",
    log: { message: "Failed to get credit batch production run options", context: { op: "credit-batch:production-run-options" } },
  });
}

/**
 * Create a new credit batch
 */
export async function createCreditBatchFn(
  data: z.infer<typeof createCreditBatchSchema>
): Promise<ActionResult<SavedCreditBatch>> {
  const result = await withAction(async (ctx) => {
    const { facilityId } = creditBatchFacilitySchema.parse(data);
    const certifier = await getCreditBatchCertifierForFacility(ctx, facilityId);
    const validated = creditBatchFormSchemaForCertifier(certifier).parse(data);

    const creditBatch = await withAutoCode(
      ctx,
      "CB",
      creditBatches,
      creditBatches.code,
      undefined,
      (code) => createCreditBatchData(ctx, { ...validated, code })
    );

    return creditBatch;
  }, {
    fallbackMessage: "Failed to create credit batch",
    log: { message: "Failed to create credit batch", context: { op: "credit-batch:create" } },
  });
  // The batch is committed. Its accounting roll-up runs after that commit and
  // can fail on its own; when it does the batch comes back without a preview,
  // and the operator is told what is saved rather than that nothing is
  // (issue #769).
  return result.success && !result.data.previewAvailable
    ? { ...result, warning: SAVED_DETAILS_UNAVAILABLE }
    : result;
}

/**
 * Update a credit batch
 */
export async function updateCreditBatchFn(
  data: z.infer<typeof updateCreditBatchSchema>
): Promise<ActionResult<SavedCreditBatch>> {
  const result = await withAction(async (ctx) => {

    const validated = updateCreditBatchSchema.parse(data);
    const { creditBatchId, ...updateData } = validated;

    // Check credit batch exists
    const existing = await getCreditBatchById(ctx, creditBatchId);
    if (!existing) {
      throw new SafeError("Credit batch not found");
    }

    // Check for duplicate code if code is being updated
    if (updateData.code && updateData.code !== existing.code) {
      const codeExists = await creditBatchCodeExists(
        ctx,
        updateData.code,
        creditBatchId
      );
      if (codeExists) {
        throw new SafeError(`Credit batch code "${updateData.code}" already exists`);
      }
    }

    // The locked writer checks entry dates; withAction preserves its conflict and recovery copy.
    const creditBatch = await updateCreditBatchData(ctx, creditBatchId, updateData);
    return creditBatch;
  }, { fallbackMessage: "Failed to update credit batch", log: { message: "Failed to update credit batch", context: { op: "credit-batch:update" } } });
  return result.success && !result.data.previewAvailable
    ? { ...result, warning: SAVED_DETAILS_UNAVAILABLE }
    : result;
}

/**
 * Delete a credit batch
 */
export async function deleteCreditBatchFn(
  data: z.infer<typeof deleteCreditBatchSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = deleteCreditBatchSchema.parse(data);

    // Check credit batch exists
    const existing = await getCreditBatchById(ctx, validated.creditBatchId);
    if (!existing) {
      throw new SafeError("Credit batch not found");
    }

    await deleteCreditBatchData(ctx, validated.creditBatchId, validated.expectedVersion);
    return;
  }, { fallbackMessage: "Failed to delete credit batch", log: { message: "Failed to delete credit batch", context: { op: "credit-batch:delete" } } });
}
