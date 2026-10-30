import type { DbTransaction } from "@/db";
import { creditBatchProductionRuns, feedstocks, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { recordLocks, withRecordLockGuidance } from "@/lib/record-lock";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getLineageUnderLockedArtifacts, getFeedstockLineageBatchTargets, tryLockCertifiedLineageArtifacts } from "./certification-lineage-guards";
import { getFeedstockTransportOwnerBatches } from "./feedstock-transport-ownership";
import { requireOrgScope } from "./utils";

const TRANSPORT_OWNER_LOCK_SCOPE = "feedstock-transport-owner";
const ADVISORY_LOCK_HASH_SEED = 0;

async function feedstockLabel(ctx: OrgContext, tx: DbTransaction, id: string): Promise<string> {
  requireOrgScope(ctx);
  const [feedstock] = await tx.select({ code: feedstocks.code }).from(feedstocks)
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.id, id)));
  return feedstock?.code ? `feedstock ${feedstock.code}` : "this feedstock";
}

function batchKey(batches: { creditBatchId: string }[] | undefined): string | undefined {
  return batches && JSON.stringify(batches.map(batch => batch.creditBatchId).sort());
}

export type TransportOwnershipChange = {
  mutation: "create" | "update" | "delete";
  subject: "production run" | "credit batch" | "facility" | "feedstock";
};

/** Include existing provenance and every intake a replacement bin draw can select, archived included like the allocator. */
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

const ENCLOSING_FREEZE = Symbol("feedstock transport ownership freeze");
export type TransportOwnershipFreezeScope = typeof ENCLOSING_FREEZE;

/**
 * Compare owning batch sets at the outermost write boundary. Lock the full lineage of
 * every owner change (including to or from no owner) before reading Sent facts.
 * Try-lock because the write may already hold rows that submission needs.
 * Full feedstock lineage intentionally includes Removals that counted zero.
 */
export async function prepareFeedstockTransportOwnershipFreeze(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockIds: readonly string[],
  change: TransportOwnershipChange,
  enclosingScope?: TransportOwnershipFreezeScope,
) {
  requireOrgScope(ctx);
  if (enclosingScope) return async <T>(write: (scope: TransportOwnershipFreezeScope) => Promise<T>): Promise<T> => write(enclosingScope);
  const ids = [...new Set(feedstockIds)].sort();
  // Serialize ownership writers before their snapshot. Joined scopes reuse the
  // outer locks; certification artifact locks remain post-write and non-blocking.
  for (const id of ids) {
    const key = `${TRANSPORT_OWNER_LOCK_SCOPE}:${ctx.organizationId}:${id}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, ${ADVISORY_LOCK_HASH_SEED}))`);
  }
  const before = await getFeedstockTransportOwnerBatches(ctx, ids, tx, { includeArchived: true });
  // Preserve targets before draw replacement can sever the feedstock link.
  const previousTargets = await getFeedstockLineageBatchTargets(ctx, tx, ids);
  return async function freeze<T>(write: (scope: TransportOwnershipFreezeScope) => Promise<T>): Promise<T> {
    const result = await write(ENCLOSING_FREEZE);
    const after = await getFeedstockTransportOwnerBatches(ctx, ids, tx, { includeArchived: true });
    const changed = ids.filter(id => batchKey(before.get(id)) !== batchKey(after.get(id)));
    if (!changed.length) return result;

    const targets = changed.map(entityId => ({ entityType: "feedstock" as const, entityId }));
    const artifacts = await tryLockCertifiedLineageArtifacts(ctx, tx,
      [...targets, ...changed.flatMap(id => previousTargets.get(id) ?? [])]);
    if (artifacts === null) {
      throw new DomainError("conflict", `Certification records for ${await feedstockLabel(ctx, tx, changed[0])} are being changed. Save again in a moment.`, { retryable: true });
    }
    for (const target of targets) {
      const lineage = await getLineageUnderLockedArtifacts(ctx, tx, artifacts, target);
      for (const previousTarget of previousTargets.get(target.entityId) ?? []) {
        lineage.push(...await getLineageUnderLockedArtifacts(ctx, tx, artifacts, previousTarget));
      }
      const lock = recordLocks.feedstock({ removals: lineage.map(row => row.recordLockRemoval), dependents: [] });
      if (lock.level !== "sent") continue;
      throw new DomainError("certification_locked", withRecordLockGuidance(
        `Cannot ${change.mutation} this ${change.subject} because it would change which credit batch counts the transport legs of ${await feedstockLabel(ctx, tx, target.entityId)}, and a Removal that uses this feedstock is already sent.`,
        lock,
      ));
    }
    return result;
  };
}
