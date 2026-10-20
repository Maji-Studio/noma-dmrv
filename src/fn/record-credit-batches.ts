"use server";

import { getRecordCreditBatches } from "@/data-access/record-credit-batches";
import { recordCreditBatchesSchema, type RecordCreditBatchesInput } from "@/schemas/record-credit-batches";
import type { ActionResult } from "@/types/actions";
import type { RecordCreditBatches } from "@/types/record-credit-batches";
import { withAction } from "./with-action";

/** Read-only credit batch lookup for a saved record. */
export async function getRecordCreditBatchesFn(
  input: RecordCreditBatchesInput,
): Promise<ActionResult<RecordCreditBatches>> {
  return withAction(
    (ctx) => getRecordCreditBatches(ctx, recordCreditBatchesSchema.parse(input)),
    {
      fallbackMessage: "Failed to check the credit batches",
      log: { message: "record credit batches action failed", context: { op: "record:credit-batches" } },
    },
  );
}
