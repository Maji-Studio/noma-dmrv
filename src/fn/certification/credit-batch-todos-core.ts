import { getRemovalIdsWithChangedLatestAttempt } from "@/data-access/removal-latest-attempt";
import { hasFinalizedSubmission } from "@/data-access/certification-submissions";
import { getDeletionLeasedRemovalIds } from "@/data-access/removal-deletion-lease";
import { REMOVAL_REGISTRY_DELETION_MIN_ROLE } from "@/lib/certification/removal-deletion-role";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE, REMOVAL_SUBMISSION_TYPE } from "@/lib/certification/shared";
import { loadCreditBatchRemovalDisplays } from "@/data-access/credit-batch-removal-display";
import { getCreditBatchesWithSamples } from "@/data-access/credit-batch-samples";
import { loadCreditBatchesMissingProductionRuns } from "@/data-access/credit-batch-missing-production-runs";
import { hasOrgRole, type OrgContext } from "@/lib/auth/server";
import { findInterruptedRemoval } from "@/lib/certification/status";
import { batchLinesToDecide, deriveBatchHealth, type BatchHealthState } from "@/lib/certification/batch-health";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import { buildDurabilityBatchSummaries } from "@/lib/certification/durability-batch-summary";
import { buildCreditBatchOpenItems, type CreditBatchOpenItem } from "@/lib/credit-batches/open-items";
import { SafeError } from "@/lib/errors";
import { loadBatchesEmissionLines } from "@/lib/read-models/batches-emission-lines";
import { buildCreditBatchContexts, loadFacilityCertifierFacts } from "@/lib/certification/certify-context-core";

export interface CreditBatchTodos {
  state: BatchHealthState;
  linesToDecide: number;
  blocking: CreditBatchOpenItem[];
  check: CreditBatchOpenItem[];
  /** Any holding Removal interrupted: the batch-level rule every surface reads. */
  removalInterrupted: boolean;
  /** Any holder has a submitted version, using the batch page phase rule. */
  hasSubmittedRemoval: boolean;
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
  const [batchesWithSamples, emissionDisplayByBatch, missingProductionRunsByBatch, removalsByBatch] = await Promise.all([
    getCreditBatchesWithSamples(ctx, ids),
    loadBatchesEmissionLines(ctx, batches, { comments: false }),
    loadCreditBatchesMissingProductionRuns(ctx, ids),
    loadCreditBatchRemovalDisplays(ctx, ids),
  ]);
  const durabilityByBatch = new Map(buildDurabilityBatchSummaries(batchesWithSamples)
    .map((summary) => [summary.creditBatchId, summary]));
  const interruptedIds = new Set([...removalsByBatch.values()].flatMap((removals) =>
    removals.filter((removal) => removal.status.kind === "interrupted").map((removal) => removal.id),
  ));
  const changedRemovalIds = await getRemovalIdsWithChangedLatestAttempt(ctx, [...interruptedIds]);
  const changedIds = [...changedRemovalIds];
  const [deletionLeasedIds, finalizedEntries] = await Promise.all([
    getDeletionLeasedRemovalIds(ctx, changedIds),
    Promise.all(changedIds.map(async (localEntityId) => [localEntityId, await hasFinalizedSubmission(ctx, {
      provider: ISOMETRIC_PROVIDER, submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE, localEntityId,
    })] as const)),
  ]);
  const finalizedByRemoval = new Map(finalizedEntries);
  const canManage = ctx.isPlatformAdmin || ctx.orgRole === "admin";
  const canDeleteRegistryRemovals = hasOrgRole(ctx, REMOVAL_REGISTRY_DELETION_MIN_ROLE);
  return new Map(ids.map((id) => {
    const health = healthByBatch.get(id)!;
    const emissionDisplay = emissionDisplayByBatch.get(id);
    const removals = removalsByBatch.get(id);
    const { blocking, check } = buildCreditBatchOpenItems({
      facilityId, creditBatchId: id, canManage, canDeleteRegistryRemovals, health,
      removals: removals?.map((removal) => ({
        ...removal,
        ...(changedRemovalIds.has(removal.id) ? { changedSinceReview: true as const } : {}),
        ...(finalizedByRemoval.get(removal.id) ? { finalized: true as const } : {}),
        ...(deletionLeasedIds.has(removal.id) ? { deletionInProgress: true as const } : {}),
      })),
      durability: durabilityByBatch.get(id),
      emissionLines: emissionDisplay?.status === "ready" ? emissionDisplay.lines : undefined,
      missingProductionRuns: missingProductionRunsByBatch.get(id),
    });
    return [id, {
      state: health.state, linesToDecide: batchLinesToDecide(health), blocking, check,
      removalInterrupted: findInterruptedRemoval(removals) !== undefined,
      hasSubmittedRemoval: removals?.some((removal) => removal.phase === "submitted") ?? false,
    }];
  }));
}
