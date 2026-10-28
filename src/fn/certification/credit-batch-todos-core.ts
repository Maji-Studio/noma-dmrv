import { getCreditBatchesWithSamples } from "@/data-access/credit-batch-samples";
import { loadCreditBatchesLateProductionRuns } from "@/data-access/credit-batch-late-production-runs";
import type { OrgContext } from "@/lib/auth/server";
import { batchLinesToDecide, deriveBatchHealth, type BatchHealthState } from "@/lib/certification/batch-health";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import { buildDurabilityBatchSummaries } from "@/lib/certification/durability-batch-summary";
import { buildCreditBatchOpenItems, type CreditBatchOpenItem } from "@/lib/credit-batches/open-items";
import { SafeError } from "@/lib/errors";
import { loadBatchesEmissionLines } from "@/lib/read-models/batches-emission-lines";
import { buildCreditBatchContexts, loadFacilityCertifierFacts } from "./certify-context-core";

export interface CreditBatchTodos {
  state: BatchHealthState;
  linesToDecide: number;
  blocking: CreditBatchOpenItem[];
  check: CreditBatchOpenItem[];
}

/** Shared read for batches whose organization and facility the caller authorized. */
export async function loadCreditBatchTodos(
  ctx: OrgContext,
  facilityId: string,
  batches: readonly { id: string; removalTemplateId: string | null }[],
): Promise<Map<string, CreditBatchTodos>> {
  if (!batches.length) return new Map();
  const ids = batches.map((batch) => batch.id);
  // Observations written by this read must be available to the emission loader.
  const facilityFacts = await loadFacilityCertifierFacts(ctx, facilityId);
  const { contextsByBatch } = await buildCreditBatchContexts(ctx, ids, facilityFacts);
  const healthByBatch = new Map(ids.map((id) => {
    const context = contextsByBatch[id];
    if (context.facilityId !== facilityId) {
      throw new SafeError("Batch does not belong to requested facility");
    }
    return [id, deriveBatchHealth(toBatchHealthFacts(context, id))];
  }));
  const [batchesWithSamples, emissionDisplayByBatch, lateProductionRunsByBatch] = await Promise.all([
    getCreditBatchesWithSamples(ctx, ids),
    loadBatchesEmissionLines(ctx, batches, { comments: false }),
    loadCreditBatchesLateProductionRuns(ctx, ids),
  ]);
  const durabilityByBatch = new Map(buildDurabilityBatchSummaries(batchesWithSamples)
    .map((summary) => [summary.creditBatchId, summary]));
  const canManage = ctx.isPlatformAdmin || ctx.orgRole === "admin";
  return new Map(ids.map((id) => {
    const health = healthByBatch.get(id)!;
    const emissionDisplay = emissionDisplayByBatch.get(id);
    const { blocking, check } = buildCreditBatchOpenItems({
      facilityId, creditBatchId: id, canManage, health,
      durability: durabilityByBatch.get(id),
      emissionLines: emissionDisplay?.status === "ready" ? emissionDisplay.lines : undefined,
      lateProductionRuns: lateProductionRunsByBatch.get(id),
    });
    return [id, { state: health.state, linesToDecide: batchLinesToDecide(health), blocking, check }];
  }));
}
