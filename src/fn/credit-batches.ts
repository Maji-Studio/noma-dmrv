"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { getUser } from "@/lib/auth/server";
import { creditBatches } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  getCreditBatches as getCreditBatchesData,
  getCreditBatchById,
  createCreditBatch as createCreditBatchData,
  updateCreditBatch as updateCreditBatchData,
  deleteCreditBatch as deleteCreditBatchData,
  creditBatchCodeExists,
  type CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import {
  createCreditBatchSchema,
  updateCreditBatchSchema,
  deleteCreditBatchSchema,
} from "@/schemas/credit-batches";

/**
 * Get all credit batches
 */
export async function getCreditBatchesFn(): Promise<
  ActionResult<CreditBatchWithRelations[]>
> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const creditBatches = await getCreditBatchesData(user.id);
    return { success: true, data: creditBatches };
  } catch (error) {
    console.error("Failed to get credit batches:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get credit batches",
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
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const creditBatch = await getCreditBatchById(user.id, id);
    if (!creditBatch) {
      return { success: false, error: "Credit batch not found" };
    }

    return { success: true, data: creditBatch };
  } catch (error) {
    console.error("Failed to get credit batch:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get credit batch",
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
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createCreditBatchSchema.parse(data);

    const creditBatch = await withAutoCode(
      "CB",
      creditBatches,
      creditBatches.code,
      undefined,
      (code) => createCreditBatchData(user.id, { ...validated, code })
    );

    return { success: true, data: creditBatch };
  } catch (error) {
    console.error("Failed to create credit batch:", error);
    if (error instanceof z.ZodError) {
      const msg = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      return { success: false, error: msg };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create credit batch",
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
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateCreditBatchSchema.parse(data);
    const { creditBatchId, ...updateData } = validated;

    // Check credit batch exists
    const existing = await getCreditBatchById(user.id, creditBatchId);
    if (!existing) {
      return { success: false, error: "Credit batch not found" };
    }

    // Check for duplicate code if code is being updated
    if (updateData.code && updateData.code !== existing.code) {
      const codeExists = await creditBatchCodeExists(
        user.id,
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

    const creditBatch = await updateCreditBatchData(user.id, creditBatchId, updateData);
    return { success: true, data: creditBatch };
  } catch (error) {
    console.error("Failed to update credit batch:", error);
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((e) => e.message).join(", "),
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update credit batch",
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
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteCreditBatchSchema.parse(data);

    // Check credit batch exists
    const existing = await getCreditBatchById(user.id, validated.creditBatchId);
    if (!existing) {
      return { success: false, error: "Credit batch not found" };
    }

    await deleteCreditBatchData(user.id, validated.creditBatchId);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Failed to delete credit batch:", error);
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((e) => e.message).join(", "),
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete credit batch",
    };
  }
}
