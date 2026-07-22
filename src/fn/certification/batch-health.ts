"use server";

import {
  deriveBatchHealth,
  type BatchHealth,
} from "@/lib/certification/batch-health";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadCertifyContextForCreditBatchForUser } from "./certify-context-core";

// Per-batch health verdict for the credit-batch detail page (and, later, the
// New-Removal wizard's selection gate). Reuses the single-batch certify context
// — for an ungrouped batch that context describes the batch alone — then runs
// the shared pure classifier so the detail page, the wizard, and any overview
// hint can never disagree on whether a batch is "ready".
export async function loadBatchHealth(
  creditBatchId: string,
): Promise<ActionResult<BatchHealth>> {
  return withAction(async (orgCtx) => {
    // Keep health at the batch grain after grouping; the submission workspace
    // intentionally continues to use the aggregate removal context.
    const ctx = await loadCertifyContextForCreditBatchForUser(
      orgCtx,
      creditBatchId,
      { singleBatch: true },
    );
    return deriveBatchHealth(toBatchHealthFacts(ctx, creditBatchId));
  });
}
