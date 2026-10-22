"use server";

import { previewRecordCreditBatches } from "@/data-access/record-credit-batch-preview";
import { getRecordCreditBatches } from "@/data-access/record-credit-batches";
import {
  recordCreditBatchPreviewSchema,
  recordCreditBatchesSchema,
  type RecordCreditBatchPreviewInput,
  type RecordCreditBatchesInput,
} from "@/schemas/record-credit-batches";
import type { ActionResult } from "@/types/actions";
import type { RecordCreditBatchPreview, RecordCreditBatches } from "@/types/record-credit-batches";
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

/** Which credit batches an unsaved record would join, from its chosen source; read-only. */
export async function previewRecordCreditBatchesFn(
  input: RecordCreditBatchPreviewInput,
): Promise<ActionResult<RecordCreditBatchPreview>> {
  return withAction(
    (ctx) => previewRecordCreditBatches(ctx, recordCreditBatchPreviewSchema.parse(input)),
    {
      fallbackMessage: "Failed to check the credit batches",
      log: { message: "record credit batch preview action failed", context: { op: "record:credit-batch-preview" } },
    },
  );
}
