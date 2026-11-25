import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { certificationSubmissions, certifierRemovals, creditBatches, feedstocks, productionRunFeedstocks, productionRuns, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { canTransferProductionReservation } from "@/lib/certification/production-reservation-policy";
import { recordLocks, withRecordLockGuidance } from "@/lib/record-lock";
import { assertLockedLineagesAllowMutation, CertificationLineageChangedError, tryLockCertifiedLineageArtifacts } from "./certification-lineage-guards";
import { loadRunEmissionContributors } from "./credit-batch-emission-contributors";
import { tryLockProductionProcessScope } from "./production-processes";
import { requireOrgScope } from "./utils";

const changed = () => new DomainError("conflict", "Production emission sources changed while this record was being saved. Refresh and retry.", { retryable: true });

/** Late targets use try locks: callers may already hold run, stock or process locks. */
export async function assertFailedEmissionBatchesEditable(
  ctx: OrgContext, tx: DbTransaction, batchIds: readonly string[], mutation: "update" | "delete" = "update",
  subjectEntityType: "productionRun" | "creditBatch" = "productionRun",
): Promise<void> {
  requireOrgScope(ctx);
  const ids = [...new Set(batchIds)].sort();
  if (!ids.length) return;
  const targets = ids.map(entityId => ({ entityType: "creditBatch" as const, entityId }));
  const keys = await tryLockCertifiedLineageArtifacts(ctx, tx, targets);
  if (!keys) throw changed();
  await synchronizeFailedEmissionBatches(ctx, tx, ids);
  try {
    await assertLockedLineagesAllowMutation(ctx, tx, keys, targets.map(target => ({
      target, mutation, subjectEntityType,
    })));
  } catch (error) {
    if (error instanceof CertificationLineageChangedError) throw changed();
    throw error;
  }
}

/** Ownership writers also protect every old/new owner batch, across facilities. */
export async function synchronizeFailedEmissionBatches(
  ctx: OrgContext, tx: DbTransaction, batchIds: readonly string[],
): Promise<void> {
  requireOrgScope(ctx);
  const ids = [...new Set(batchIds)].sort();
  if (!ids.length) return;
  const batches = await tx.select().from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.id, ids),
  )).orderBy(creditBatches.id).for("update", { skipLocked: true });
  if (batches.length !== ids.length) throw changed();
  for (const batch of batches) {
    if (!batch.productionEmissionsClaimReservedBySubmissionId) continue;
    const [owner] = await tx.select().from(certificationSubmissions).where(and(
      eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.id, batch.productionEmissionsClaimReservedBySubmissionId),
    ));
    if (canTransferProductionReservation(owner, Date.now())) continue;
    const [removal] = owner ? await tx.select({ code: certifierRemovals.code }).from(certifierRemovals).where(and(
      eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, owner.localEntityId),
    )) : [];
    const lock = recordLocks.productionRun({ dependents: [], removals: [{
      id: owner?.localEntityId ?? batch.productionEmissionsClaimReservedBySubmissionId,
      label: removal?.code, submissions: [{ status: "draft", inFlight: true }], statements: [],
    }] });
    throw new DomainError("certification_locked", withRecordLockGuidance("This production run cannot change while its production emissions are being sent.", lock));
  }
}

type ProspectiveRun = { facilityId?: string; status?: string; feedstockTypeIds?: readonly string[]; feedstockDraws?: readonly { storageLocationId: string }[] };

/**
 * The facility and run are already locked by the writer. Capture old attachment
 * before replacing draws, acquire old/new cohort scopes in sorted order, and
 * check the final attachment before the enclosing transaction can commit.
 * No membership rows or extra stock withdrawals are created here.
 */
export async function prepareFailedRunEmissionWrite(
  ctx: OrgContext, tx: DbTransaction, runId: string, prospective: ProspectiveRun = {},
): Promise<() => Promise<void>> {
  requireOrgScope(ctx);
  const [run] = await tx.select({ facilityId: productionRuns.facilityId, status: productionRuns.status }).from(productionRuns).where(and(
    eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, runId),
  ));
  if (!run || (run.status !== "failed" && prospective.status !== "failed")) return async () => {};
  const old = await loadRunEmissionContributors(ctx, [runId], tx, { includeArchived: true });
  const types = await tx.selectDistinct({ id: feedstocks.feedstockTypeId }).from(productionRunFeedstocks)
    .innerJoin(feedstocks, and(eq(feedstocks.id, productionRunFeedstocks.feedstockId), eq(feedstocks.organizationId, ctx.organizationId)))
    .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), eq(productionRunFeedstocks.productionRunId, runId)));
  const binIds = prospective.feedstockDraws?.map(draw => draw.storageLocationId) ?? [];
  const bins = binIds.length ? await tx.select({ id: storageLocations.feedstockTypeId }).from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), inArray(storageLocations.id, binIds),
  )) : [];
  const scopes = [...new Set([run.facilityId, prospective.facilityId ?? run.facilityId])].flatMap(facilityId =>
    [...new Set([...types, ...bins, ...(prospective.feedstockTypeIds ?? []).map(id => ({ id }))].map(type => type.id).filter((id): id is string => id !== null))]
      .map(feedstockTypeId => ({ facilityId, feedstockTypeId })));
  scopes.sort((a, b) => `${a.facilityId}:${a.feedstockTypeId}`.localeCompare(`${b.facilityId}:${b.feedstockTypeId}`));
  for (const scope of scopes) if (!await tryLockProductionProcessScope(ctx, tx, scope)) throw changed();
  const oldBatchIds = old.filter(row => row.kind === "failed" && row.creditBatchId).map(row => row.creditBatchId!);
  await assertFailedEmissionBatchesEditable(ctx, tx, oldBatchIds);
  return async () => {
    const next = await loadRunEmissionContributors(ctx, [runId], tx, { includeArchived: true });
    for (const row of next.filter(row => row.kind === "failed" && row.feedstockTypeId)) {
      if (!scopes.some(scope => scope.facilityId === row.facilityId && scope.feedstockTypeId === row.feedstockTypeId)) {
        // Provenance changed outside the prepared cohort union. Retrying starts
        // with the new source set; never take another blocking scope here.
        throw changed();
      }
    }
    await assertFailedEmissionBatchesEditable(ctx, tx, [...oldBatchIds,
      ...next.filter(row => row.kind === "failed" && row.creditBatchId).map(row => row.creditBatchId!),
    ]);
  };
}
