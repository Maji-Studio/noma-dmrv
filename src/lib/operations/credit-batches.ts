import { withAutoCodes } from "@/data-access/code-generator";
import { CREDIT_BATCH_CODE_PREFIX } from "@/config/credit-batches";
import { createCreditBatchInTransaction, type CommittedCreditBatch } from "@/data-access/credit-batches";
import { creditBatches } from "@/db/schema";
import { creditBatchFormSchemaForCertifier } from "@/schemas/credit-batches";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
const createCreditBatchInput = creditBatchFormSchemaForCertifier(null);

export const createCreditBatch: Operation<typeof createCreditBatchInput, CommittedCreditBatch> = {
  id: "create_credit_batch",
  input: createCreditBatchInput,
  supportsDryRun: false,
  execute: ({ ctx, tx, source }, input) => withAutoCodes(ctx, tx, CREDIT_BATCH_CODE_PREFIX, creditBatches, creditBatches.code, AUTO_CODE_COUNT,
    ([code], savepoint) => createCreditBatchInTransaction(ctx, savepoint, { ...input, code }, source)),
};
