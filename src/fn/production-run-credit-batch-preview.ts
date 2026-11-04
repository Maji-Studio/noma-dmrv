"use server";

/**
 * The Production Run form's credit batch line (#1164). Its own module, so the
 * production-run actions keep their import graph.
 */
import { getProductionRunCreditBatchPreview } from "@/data-access/production-run-credit-batch-preview";
import {
  productionRunCreditBatchPreviewSchema,
  type ProductionRunCreditBatchPreviewInput,
} from "@/schemas/production-run-credit-batch-preview";
import type { ActionResult } from "@/types/actions";
import type { ProductionRunCreditBatchPreview } from "@/types/production-run-credit-batch-preview";
import { withAction } from "./with-action";

/** Which credit batch the unsaved run joins; read-only. */
export async function previewProductionRunCreditBatchFn(
  input: ProductionRunCreditBatchPreviewInput,
): Promise<ActionResult<ProductionRunCreditBatchPreview>> {
  return withAction(
    (ctx) => getProductionRunCreditBatchPreview(ctx, productionRunCreditBatchPreviewSchema.parse(input)),
    {
      fallbackMessage: "Failed to check the credit batch",
      log: { message: "production run action failed", context: { op: "production-run:credit-batch-preview" } },
    },
  );
}
