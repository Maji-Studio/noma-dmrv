"use server";

import { getCreditBatchesWithSamples } from "@/data-access/credit-batch-samples";
import {
  buildDurabilityBatchSummaries,
  type DurabilityBatchSummary,
} from "@/lib/certification/durability-batch-summary";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

// The two Phase-5 readiness surfaces (the credit-batch detail's durability
// panel and the lab-sample form's batch progress preview) read the
// credit-batch-grained durability data plane (ADR 0016) and shape it with the
// SAME `buildDurabilityBatchSummaries` pure builder the submit pipeline's
// aggregation feeds — so the form preview, the detail panel, and what's
// actually submitted can never disagree.

/**
 * The durability sampling roll-up + readiness for one credit batch. Null when
 * the batch isn't found (e.g. deleted between navigations). Since issue #309
 * the lab-sample form anchors samples on the batch directly, so this is the
 * single summary loader (no run-derived variant).
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
