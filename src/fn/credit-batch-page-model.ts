"use server";

import { uuidSchema } from "@/schemas/helpers";
import { getCreditBatchPageModel, type CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

export async function getCreditBatchPageModelFn(creditBatchId: string): Promise<ActionResult<CreditBatchPageModel>> {
  return withAction(ctx => getCreditBatchPageModel(ctx, uuidSchema("Choose a valid credit batch.").parse(creditBatchId)), {
    fallbackMessage: "Failed to get credit batch page model",
    log: { message: "Failed to get credit batch page model", context: { op: "credit-batch:page-model" } },
  });
}
