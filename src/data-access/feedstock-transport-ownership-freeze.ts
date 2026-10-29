import type { DbTransaction } from "@/db";
import { creditBatchProductionRuns, feedstocks, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { recordLocks, withRecordLockGuidance } from "@/lib/record-lock";
import { and, eq, inArray, or } from "drizzle-orm";
import { getLineageUnderLockedArtifacts, getRecordLocks, tryLockCertifiedLineageArtifacts } from "./certification-lineage-guards";
import { getFeedstockTransportOwners } from "./feedstock-transport-ownership";
import { requireOrgScope } from "./utils";

/** Include existing provenance and every intake a replacement bin draw can select. */
export async function getTransportFreezeFeedstockIds(
  ctx: OrgContext,
  tx: DbTransaction,
  candidates: { runIds?: readonly string[]; batchIds?: readonly string[]; binIds?: readonly string[]; facilityId?: string },
): Promise<string[]> {
  requireOrgScope(ctx);
  const conditions = [
    candidates.runIds?.length ? inArray(productionRuns.id, [...candidates.runIds]) : undefined,
    candidates.batchIds?.length ? inArray(creditBatchProductionRuns.creditBatchId, [...candidates.batchIds]) : undefined,
    candidates.facilityId ? eq(productionRuns.facilityId, candidates.facilityId) : undefined,
  ].filter(condition => condition !== undefined);
  const draws = conditions.length ? await tx.selectDistinct({ id: productionRunFeedstocks.feedstockId })
    .from(productionRunFeedstocks)
    .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunFeedstocks.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(creditBatchProductionRuns, and(eq(creditBatchProductionRuns.productionRunId, productionRuns.id), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)))
    .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), or(...conditions))) : [];
  const intakes = candidates.binIds?.length ? await tx.select({ id: feedstocks.id }).from(feedstocks)
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), inArray(feedstocks.storageLocationId, [...candidates.binIds]))) : [];
  return [...new Set([...draws, ...intakes].map(row => row.id))].sort();
}

/**
 * Read owners before the write without acquiring locks. Only changed owners
 * with advisory Sent lineage need an artifact-locked recheck after the write.
 * Try-lock because the write may already hold rows that submission needs.
 * Full feedstock lineage intentionally includes Removals that counted zero.
 */
export async function prepareFeedstockTransportOwnershipFreeze(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockIds: readonly string[],
  change: { mutation: "update" | "delete" | "archive" | "restore"; subject: "production run" | "credit batch" },
) {
  requireOrgScope(ctx);
  const ids = [...new Set(feedstockIds)].sort();
  const before = await getFeedstockTransportOwners(ctx, ids, tx);
  return async function freeze<T>(write: () => Promise<T>): Promise<T> {
    const result = await write();
    const after = await getFeedstockTransportOwners(ctx, ids, tx);
    const changed = ids.filter(id => before.get(id) !== after.get(id));
    if (!changed.length) return result;

    const targets = changed.map(entityId => ({ entityType: "feedstock" as const, entityId }));
    const advisoryLocks = await getRecordLocks(ctx, tx, targets, { sentOnly: true });
    const sentTargets = targets.filter((_, index) => advisoryLocks[index].level === "sent");
    // This fast path intentionally does not serialize a newly starting submit
    // against ownership changes in other batches sharing the same intake.
    if (!sentTargets.length) return result;

    const artifacts = await tryLockCertifiedLineageArtifacts(ctx, tx, sentTargets);
    if (artifacts === null) {
      throw new DomainError("conflict", "Feedstock transport ownership is being updated. Refresh and retry.", { retryable: true });
    }
    for (const target of sentTargets) {
      const lineage = await getLineageUnderLockedArtifacts(ctx, tx, artifacts, target);
      const lock = recordLocks.feedstock({ removals: lineage.map(row => row.recordLockRemoval), dependents: [] });
      if (lock.level !== "sent") continue;
      const [feedstock] = await tx.select({ code: feedstocks.code }).from(feedstocks)
        .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.id, target.entityId)));
      throw new DomainError("certification_locked", withRecordLockGuidance(
        `Cannot ${change.mutation} this ${change.subject} because it would change which credit batch counts the truck trips of feedstock ${feedstock?.code ?? target.entityId}, and a sent Removal already counted them.`,
        lock,
      ));
    }
    return result;
  };
}
