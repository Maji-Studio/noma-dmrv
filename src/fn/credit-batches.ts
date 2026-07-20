"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { requireOrgContext } from "@/lib/auth/server";
import { toActionError } from "@/lib/errors";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import { creditBatches } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import { requireOrgFacility } from "@/data-access/utils";
import {
  getCreditBatches as getCreditBatchesData,
  getCreditBatchById,
  getCo2eStoredPreviews as getCo2eStoredPreviewsData,
  getCreditBatchProductionRunOptions,
  createCreditBatch as createCreditBatchData,
  updateCreditBatch as updateCreditBatchData,
  deleteCreditBatch as deleteCreditBatchData,
  creditBatchCodeExists,
  type CreditBatchWithRelations,
  type CreditBatchCo2eStoredPreview,
  type CreditBatchProductionRunOption,
} from "@/data-access/credit-batches";
import {
  createCreditBatchSchema,
  updateCreditBatchSchema,
  deleteCreditBatchSchema,
} from "@/schemas/credit-batches";

const MAX_BATCH_PREVIEWS = 50;

function logCreditBatchError(message: string, error: unknown): void {
  logger.error(
    {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: sanitizeErrorMessage(error),
    },
    message,
  );
}

/**
 * Get credit batches for a facility
 */
export async function getCreditBatchesFn(
  facilityId: string,
): Promise<ActionResult<CreditBatchWithRelations[]>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFacilityId = z.string().uuid().parse(facilityId);
    await requireOrgFacility(ctx, validatedFacilityId);
    const creditBatches = await getCreditBatchesData(
      ctx,
      validatedFacilityId,
    );
    return { success: true, data: creditBatches };
  } catch (error) {
    logCreditBatchError("Failed to get credit batches", error);
    return {
      success: false,
      error: toActionError(error, "Failed to get credit batches"),
    };
  }
}

/**
 * Get credit batch by ID
 */
export async function getCreditBatchByIdFn(
  id: string
): Promise<ActionResult<CreditBatchWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const creditBatch = await getCreditBatchById(ctx, id);
    if (!creditBatch) {
      return { success: false, error: "Credit batch not found" };
    }

    return { success: true, data: creditBatch };
  } catch (error) {
    logCreditBatchError("Failed to get credit batch", error);
    return {
      success: false,
      error: toActionError(error, "Failed to get credit batch"),
    };
  }
}

export async function getCo2eStoredPreviewsFn(
  batchIds: string[]
): Promise<ActionResult<Record<string, CreditBatchCo2eStoredPreview>>> {
  try {
    const ctx = await requireOrgContext();

    const ids = z
      .array(z.string().uuid())
      .max(
        MAX_BATCH_PREVIEWS,
        `Select at most ${MAX_BATCH_PREVIEWS} credit batches for preview`,
      )
      .parse(batchIds);
    const previews = await getCo2eStoredPreviewsData(ctx, ids);
    return { success: true, data: previews };
  } catch (error) {
    logCreditBatchError("Failed to get CO2e stored previews", error);
    return {
      success: false,
      error: toActionError(error, "Failed to get CO2e stored previews"),
    };
  }
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
  try {
    const ctx = await requireOrgContext();

    const validated = creditBatchProductionRunOptionsSchema.parse(input);
    await requireOrgFacility(ctx, validated.facilityId);
    const options = await getCreditBatchProductionRunOptions(
      ctx,
      validated,
    );
    return { success: true, data: options };
  } catch (error) {
    logCreditBatchError("Failed to get credit batch production run options", error);
    return {
      success: false,
      error: toActionError(
        error,
        "Failed to get credit batch production run options",
      ),
    };
  }
}

/**
 * Create a new credit batch
 */
export async function createCreditBatchFn(
  data: z.infer<typeof createCreditBatchSchema>
): Promise<ActionResult<CreditBatchWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createCreditBatchSchema.parse(data);

    const creditBatch = await withAutoCode(
      ctx,
      "CB",
      creditBatches,
      creditBatches.code,
      undefined,
      (code) => createCreditBatchData(ctx, { ...validated, code })
    );

    return { success: true, data: creditBatch };
  } catch (error) {
    logCreditBatchError("Failed to create credit batch", error);
    if (error instanceof z.ZodError) {
      const msg = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      return { success: false, error: msg };
    }
    return {
      success: false,
      error: toActionError(error, "Failed to create credit batch"),
    };
  }
}

/**
 * Update a credit batch
 */
export async function updateCreditBatchFn(
  data: z.infer<typeof updateCreditBatchSchema>
): Promise<ActionResult<CreditBatchWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const validated = updateCreditBatchSchema.parse(data);
    const { creditBatchId, ...updateData } = validated;

    // Check credit batch exists
    const existing = await getCreditBatchById(ctx, creditBatchId);
    if (!existing) {
      return { success: false, error: "Credit batch not found" };
    }

    // Check for duplicate code if code is being updated
    if (updateData.code && updateData.code !== existing.code) {
      const codeExists = await creditBatchCodeExists(
        ctx,
        updateData.code,
        creditBatchId
      );
      if (codeExists) {
        return {
          success: false,
          error: `Credit batch code "${updateData.code}" already exists`,
        };
      }
    }

    const creditBatch = await updateCreditBatchData(ctx, creditBatchId, updateData);
    return { success: true, data: creditBatch };
  } catch (error) {
    logCreditBatchError("Failed to update credit batch", error);
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((e) => e.message).join(", "),
      };
    }
    return {
      success: false,
      error: toActionError(error, "Failed to update credit batch"),
    };
  }
}

/**
 * Delete a credit batch
 */
export async function deleteCreditBatchFn(
  data: z.infer<typeof deleteCreditBatchSchema>
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireOrgContext();

    const validated = deleteCreditBatchSchema.parse(data);

    // Check credit batch exists
    const existing = await getCreditBatchById(ctx, validated.creditBatchId);
    if (!existing) {
      return { success: false, error: "Credit batch not found" };
    }

    await deleteCreditBatchData(ctx, validated.creditBatchId);
    return { success: true, data: undefined };
  } catch (error) {
    logCreditBatchError("Failed to delete credit batch", error);
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((e) => e.message).join(", "),
      };
    }
    return {
      success: false,
      error: toActionError(error, "Failed to delete credit batch"),
    };
  }
}
