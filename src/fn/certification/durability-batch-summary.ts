"use server";

import {
  getCreditBatchesWithSamples,
  getCreditBatchIdForRun,
} from "@/data-access/credit-batch-samples";
import {
  buildDurabilityBatchSummaries,
  type DurabilityBatchSummary,
} from "@/lib/certification/durability-batch-summary";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

// The two Phase-5 readiness surfaces read the credit-batch-grained durability
// data plane (ADR 0015) and shape it with the SAME `buildDurabilityBatchSummaries`
// pure builder the submit pipeline's aggregation feeds — so the form preview, the
// detail panel, and what's actually submitted can never disagree.

/**
 * The durability sampling roll-up + readiness for one credit batch (the
 * credit-batch detail page's durability section). Null when the batch isn't found
 * (e.g. deleted between navigations).
 */
export async function loadCreditBatchDurabilitySummary(
  creditBatchId: string,
): Promise<ActionResult<DurabilityBatchSummary | null>> {
  return withAction(async (userId) => {
    const batches = await getCreditBatchesWithSamples(userId, [creditBatchId]);
    const [summary] = buildDurabilityBatchSummaries(batches);
    return summary ?? null;
  });
}

export interface RunDurabilitySummary {
  /** The credit batch the run is committed to (≤1 by the join constraint). */
  creditBatch: DurabilityBatchSummary | null;
}

/**
 * The durability sampling progress for the credit batch a production run belongs
 * to (the lab-sample create form's derived-batch preview). `creditBatch` is null
 * when the run isn't yet committed to a batch — the form surfaces that honestly
 * rather than silently picking one (the sample still saves against the run).
 */
export async function loadRunDurabilitySummary(
  productionRunId: string,
): Promise<ActionResult<RunDurabilitySummary>> {
  return withAction(async (userId) => {
    const ref = await getCreditBatchIdForRun(userId, productionRunId);
    if (!ref) return { creditBatch: null };
    const batches = await getCreditBatchesWithSamples(userId, [
      ref.creditBatchId,
    ]);
    const [summary] = buildDurabilityBatchSummaries(batches);
    return { creditBatch: summary ?? null };
  });
}
