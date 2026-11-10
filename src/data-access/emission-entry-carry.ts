import { deriveEmissionEntryDisposition, type CarryEntry } from "@/lib/certification/emission-entry-disposition";
import type { CarryContender } from "@/lib/certification/emission-entry-carry";
import type { EntryContender } from "@/lib/certification/removal-emission-contributions";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE, REMOVAL_SUBMISSION_TYPE } from "@/lib/isometric/utils/constants";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, creditBatchApplications, certifierRemovals, certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { loadPersistedEmissionCorrectionLineages } from "./emission-entry-revisions";
import { readRecordLockLineage } from "./record-lock-lineage";
import { requireOrgScope } from "./utils";
import { loadEmissionEntryReservations } from "./emission-entry-contenders";
import { hydrateEmissionEntries } from "./emission-entries";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "./removal-template-observations";
import { listCarryCandidates, listCarryRemovalMembers, listOwnedCarryEntries, listUnsentBatchEntries, type CarryExecutor, type CarryReadScope } from "./emission-entry-carry-queries";

/** Discovery is persisted-only, with roll-ups restricted to potential new carries. */
export async function loadFacilityEmissionEntryCarry(
  ctx: OrgContext, facilityId: string, executor: CarryExecutor = db,
  claimedAttempt?: { removalId: string; submissionId?: string },
  scope: CarryReadScope = {},
  ownedOnly = false,
) {
  requireOrgScope(ctx);
  const candidates = ownedOnly ? [] : await listCarryCandidates(ctx, facilityId, executor, scope);
  const owned = await listOwnedCarryEntries(ctx, facilityId, executor, scope);
  const unsent = scope.ownedBatchIds?.length ? await listUnsentBatchEntries(ctx, facilityId, executor, scope) : [];
  const selected = [...new Map([...candidates, ...owned, ...unsent].map(row => [row.entry.id, row])).values()];
  const empty = { entries: [] as CarryEntry[], contenders: [] as CarryContender[], ownContenders: [] as EntryContender[], batches: [] as (typeof creditBatches.$inferSelect)[] };
  if (!selected.length) return empty;
  const originIds = [...new Set(candidates.map(row => row.batch.id))];
  const allOriginIds = [...new Set(selected.map(row => row.batch.id))];
  // Only explicit batch display/revision reads broaden correction discovery.
  const correctionOriginIds = scope.ownedBatchIds?.length ? allOriginIds : originIds;
  const [stored, draftMembers, rollups, slices, previous, originMembers] = await Promise.all([
    hydrateEmissionEntries(ctx, selected.map(row => row.entry), executor),
    candidates.length ? listCarryRemovalMembers(ctx, facilityId, executor) : [],
    loadCreditBatchRollups(ctx, originIds, undefined, executor),
    executor.select().from(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, allOriginIds))),
    getTemplateObservationsByIds(ctx, selected.map(row => row.entry.observationId), executor),
    correctionOriginIds.length ? listCarryRemovalMembers(ctx, facilityId, executor, correctionOriginIds) : [],
  ]);
  const reservations = await loadEmissionEntryReservations(ctx, stored.flatMap(entry => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []), executor);
  const removalIds = [...new Set([...draftMembers.map(row => row.removal.id), ...slices.flatMap(row => row.removalId ? [row.removalId] : []),
    ...stored.flatMap(entry => [entry.sentByRemovalId, entry.heldForRemovalId].filter((id): id is string => !!id)), ...reservations.map(row => row.removalId)])];
  const [removals, memberships, attempts, observations] = await Promise.all([
    removalIds.length ? executor.select().from(certifierRemovals).where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.facilityId, facilityId), inArray(certifierRemovals.id, removalIds))) : [],
    removalIds.length ? executor.select({ removalId: creditBatchApplications.removalId, batch: creditBatches }).from(creditBatchApplications)
      .innerJoin(creditBatches, and(eq(creditBatches.id, creditBatchApplications.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)))
      .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.removalId, removalIds))) : [],
    removalIds.length ? executor.select().from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.provider, ISOMETRIC_PROVIDER), eq(certificationSubmissions.localEntityType, REMOVAL_ENTITY_TYPE),
      eq(certificationSubmissions.submissionType, REMOVAL_SUBMISSION_TYPE), inArray(certificationSubmissions.localEntityId, removalIds))) : [],
    getLatestTemplateObservations(ctx, ISOMETRIC_PROVIDER, [...new Set(draftMembers.flatMap(row => row.batch.removalTemplateId ? [row.batch.removalTemplateId] : []))], executor),
  ]);
  const nowMs = Date.now();
  const lineage = await readRecordLockLineage(ctx, executor, [...new Map(originMembers.map(row =>
    [row.removal.id, { removalId: row.removal.id, ghgStatementId: row.removal.ghgStatementId }])).values()]);
  const correctionLineages = await loadPersistedEmissionCorrectionLineages(ctx, executor, correctionOriginIds);
  return deriveEmissionEntryDisposition({
    organizationId: ctx.organizationId, facilityId, nowMs, claimedAttempt, candidates, selected,
    stored, draftMembers, rollups, slices, previous, originMembers, reservations,
    removals, memberships, attempts, observations, lineage, correctionLineages,
  });
}

/** Batch display reads discover facilities only through organization-scoped batches. */
export async function loadBatchEmissionEntryCarry(ctx: OrgContext, batchIds: string[]) {
  requireOrgScope(ctx);
  if (!batchIds.length) return [];
  const batches = await db.select({ facilityId: creditBatches.facilityId }).from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.id, batchIds),
  ));
  const contexts = await Promise.all([...new Set(batches.map(batch => batch.facilityId))]
    .map(facilityId => loadFacilityEmissionEntryCarry(ctx, facilityId, db, undefined, { ownedBatchIds: batchIds })));
  return contexts.flatMap(context => context.entries).filter(entry => batchIds.includes(entry.creditBatchId));
}
