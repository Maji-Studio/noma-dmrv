import { FAILED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { getTransportFreezeFeedstockIds, prepareFeedstockTransportOwnershipFreeze } from "./feedstock-transport-ownership-freeze";
import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { lockFacilityReferences } from "./facility-reference-guards";
import { loadRunEmissionContributors } from "./credit-batch-emission-contributors";
import { tryLockCertifiedLineageArtifacts } from "./certification-lineage-guards";
import { prepareFailedRunEmissionWrite, synchronizeFailedEmissionBatches } from "./failed-run-emission-write-guard";
import { requireOrgScope } from "./utils";

const changed = () => new DomainError("conflict", "Production emission sources changed while saving this feedstock. Refresh and retry.", { retryable: true });

/**
 * Call before the intake writer takes any rows. Include running sources: a
 * concurrent failure must serialize even if there was no failed source yet.
 * The returned prepare step runs after intake/bin locks, before the mutation.
 */
export async function prepareFailedFeedstockEmissionWrite(
  ctx: OrgContext, tx: DbTransaction, feedstockId: string, prospectiveTypeId?: string,
  prospectiveFacilityId?: string,
): Promise<(attachmentChanged: boolean) => Promise<() => Promise<void>>> {
  requireOrgScope(ctx);
  const readSources = () => tx.selectDistinct({ id: productionRuns.id, facilityId: productionRuns.facilityId })
    .from(productionRunFeedstocks).innerJoin(productionRuns, and(
      eq(productionRuns.id, productionRunFeedstocks.productionRunId), eq(productionRuns.organizationId, ctx.organizationId),
    )).where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), eq(productionRunFeedstocks.feedstockId, feedstockId)));
  const initial = await readSources();
  const facilityIds = [...new Set([...initial.map(run => run.facilityId), ...(prospectiveFacilityId ? [prospectiveFacilityId] : [])])];
  await lockFacilityReferences(ctx, tx, facilityIds);
  return async (attachmentChanged: boolean) => {
    // The source's FOR UPDATE prevents new FK links. Revalidate any links
    // committed while we acquired it; never take a late blocking run lock.
    const sources = await readSources();
    if (sources.some(run => !facilityIds.includes(run.facilityId))) throw changed();
    if (!sources.length) return async () => {};
    const runs = await tx.select({ id: productionRuns.id, facilityId: productionRuns.facilityId, status: productionRuns.status })
      .from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId),
        inArray(productionRuns.id, sources.map(run => run.id))))
      .orderBy(productionRuns.id).for("update", { skipLocked: true });
    if (runs.length !== sources.length || runs.some(run => !facilityIds.includes(run.facilityId))) throw changed();
    if (!attachmentChanged) {
      // Preserve transport-only edits excluded by the existing counted-input
      // policy. Reservation synchronization does not add a new Sent refusal.
      const contributors = await loadRunEmissionContributors(ctx, runs.map(run => run.id), tx, { includeArchived: true });
      const batchIds = [...new Set(contributors.filter(run => run.kind === "failed" && run.creditBatchId).map(run => run.creditBatchId!))];
      const keys = await tryLockCertifiedLineageArtifacts(ctx, tx, batchIds.map(entityId => ({ entityType: "creditBatch", entityId })));
      if (!keys) throw changed();
      await synchronizeFailedEmissionBatches(ctx, tx, batchIds);
      return async () => {};
    }
    // Capture ownership before the intake mutation; the returned finish step
    // checks it after the write, within the same rollback boundary.
    const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, tx,
      await getTransportFreezeFeedstockIds(ctx, tx, { runIds: runs.filter(run => run.status === FAILED_PRODUCTION_RUN_STATUS).map(run => run.id) }),
      { mutation: "update", subject: "feedstock" });
    const finish: (() => Promise<void>)[] = [];
    for (const run of runs) finish.push(await prepareFailedRunEmissionWrite(ctx, tx, run.id, {
      feedstockTypeIds: prospectiveTypeId ? [prospectiveTypeId] : [],
    }));
    return async () => freeze(async () => { for (const check of finish) await check(); });
  };
}
