import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, creditBatchApplications, certifierRemovals, certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { facilityToday } from "@/lib/date-utils";
import { creditBatchApplicationMass } from "@/lib/credit-batches/application-mass";
import { removalEntryCarryOwner, type CarryContender, type EntryCarryDestination } from "@/lib/certification/emission-entry-carry";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { deriveRemovalEntryWindow, isLiveEntryReservation } from "@/lib/certification/removal-emission-contributions";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";
import { readRecordLockLineage } from "./record-lock-lineage";
import type { EntryContender } from "@/lib/certification/removal-emission-contributions";
import { requireOrgScope } from "./utils";
import { loadEmissionEntryReservations } from "./emission-entry-contenders";
import { hydrateEmissionEntries } from "./emission-entries";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "./removal-template-observations";
import { listCarryCandidates, listCarryRemovalMembers, listOwnedCarryEntries, type CarryExecutor, type CarryReadScope } from "./emission-entry-carry-queries";

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
  const selected = [...new Map([...candidates, ...owned].map(row => [row.entry.id, row])).values()];
  const empty = { entries: [] as CarryEntry[], contenders: [] as CarryContender[], ownContenders: [] as EntryContender[], batches: [] as (typeof creditBatches.$inferSelect)[] };
  if (!selected.length) return empty;
  const originIds = [...new Set(candidates.map(row => row.batch.id))];
  const allOriginIds = [...new Set(selected.map(row => row.batch.id))];
  const [stored, draftMembers, rollups, slices, previous, originMembers] = await Promise.all([
    hydrateEmissionEntries(ctx, selected.map(row => row.entry), executor),
    candidates.length ? listCarryRemovalMembers(ctx, facilityId, executor) : [],
    loadCreditBatchRollups(ctx, originIds, undefined, executor),
    executor.select().from(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, allOriginIds))),
    getTemplateObservationsByIds(ctx, selected.map(row => row.entry.observationId), executor),
    originIds.length ? listCarryRemovalMembers(ctx, facilityId, executor, originIds) : [],
  ]);
  const reservations = await loadEmissionEntryReservations(ctx, stored.flatMap(entry => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []), executor);
  const removalIds = [...new Set([...draftMembers.map(row => row.removal.id), ...slices.flatMap(row => row.removalId ? [row.removalId] : []),
    ...stored.flatMap(entry => entry.sentByRemovalId ? [entry.sentByRemovalId] : []), ...reservations.map(row => row.removalId)])];
  const [removals, memberships, attempts, observations] = await Promise.all([
    removalIds.length ? executor.select().from(certifierRemovals).where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.facilityId, facilityId), inArray(certifierRemovals.id, removalIds))) : [],
    removalIds.length ? executor.select({ removalId: creditBatchApplications.removalId, batch: creditBatches }).from(creditBatchApplications)
      .innerJoin(creditBatches, and(eq(creditBatches.id, creditBatchApplications.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)))
      .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.removalId, removalIds))) : [],
    removalIds.length ? executor.select().from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.provider, "isometric"), eq(certificationSubmissions.localEntityType, "removal"),
      eq(certificationSubmissions.submissionType, "removal"), inArray(certificationSubmissions.localEntityId, removalIds))) : [],
    getLatestTemplateObservations(ctx, "isometric", [...new Set(draftMembers.flatMap(row => row.batch.removalTemplateId ? [row.batch.removalTemplateId] : []))], executor),
  ]);
  const nowMs = Date.now();
  const contenders: CarryContender[] = [...new Set(draftMembers.map(row => row.removal.id))].flatMap(id => {
    const rows = draftMembers.filter(row => row.removal.id === id);
    const members = [...new Map(rows.map(row => [row.batch.id, row.batch])).values()];
    const removal = rows[0].removal;
    const pins = new Set(members.map(batch => batch.removalTemplateId));
    const blocked = attempts.some(attempt => attempt.localEntityId === id && attempt.id !== claimedAttempt?.submissionId && isLiveEntryReservation(attempt, nowMs));
    const window = deriveRemovalEntryWindow(members, rows.map(row => row.applicationDate));
    if (blocked || !window || hasFreshRemovalDeletionLease(removal.metadata) || pins.size !== 1 || members.some(batch => batch.facilityId !== facilityId)) return [];
    return [{ contenderKind: "draft" as const, removalId: id, createdAt: removal.createdAt.toISOString(), window,
      creditBatchIds: members.map(batch => batch.id), organizationId: ctx.organizationId, facilityId, code: removal.code,
      creditBatchCodes: members.map(batch => batch.code).sort(),
      observation: observations.find(observation => observation.externalTemplateId === members[0].removalTemplateId) ?? null }];
  });
  // Persisted lineage cannot authorize corrections (that requires a fresh registry
  // read). Reserve their own windows conservatively instead of carrying entries
  // away while a returned or unknown covering statement might own them.
  const lineage = await readRecordLockLineage(ctx, executor, [...new Map(originMembers.map(row =>
    [row.removal.id, { removalId: row.removal.id, ghgStatementId: row.removal.ghgStatementId }])).values()]);
  const ownContenders: EntryContender[] = [...contenders, ...lineage.flatMap(fact => {
    const rows = originMembers.filter(row => row.removal.id === fact.id);
    const uncertain = fact.statements.some(statement => statement.status === null ||
      statement.status === "FAILED_VERIFICATION" || statement.status === "DRAFT" && statement.submittedToVerifier);
    const missing = rows[0]?.removal.ghgStatementId && !fact.statements.length;
    const window = deriveRemovalEntryWindow(rows.map(row => row.batch), rows.map(row => row.applicationDate));
    if ((!uncertain && !missing) || !window) return [];
    return [{ contenderKind: "correction" as const, removalId: fact.id, createdAt: rows[0].removal.createdAt.toISOString(),
      creditBatchIds: [...new Set(rows.map(row => row.batch.id))], window }];
  })];
  const previousById = new Map(previous.map(observation => [observation.id, observation]));
  const entries = stored.flatMap(entry => {
    const { batch, timezone } = selected.find(row => row.entry.id === entry.id)!;
    const observation = previousById.get(entry.observationId);
    if (!observation) return [];
    const [fact] = deriveEmissionEntryFacts([entry], observation, previousById);
    const reservation = reservations.find(row => row.submissionId === entry.sendReservedBySubmissionId);
    const live = reservation && isLiveEntryReservation(reservation, nowMs);
    // An expired draft is still resumable by its Removal. Liveness alone must
    // not elect a different receiver; terminal inactive attempts may release it.
    const retained = reservation && (live || reservation.status === "draft");
    const resolved = { ...fact, reservedByRemovalId: retained ? reservation.removalId : null, reservationKnownInactive: !entry.sendReservedBySubmissionId || !!reservation && !live };
    const mass = creditBatchApplicationMass(rollups[batch.id]?.lineageFacts.runs ?? [], slices.filter(slice => slice.creditBatchId === batch.id).map(slice => ({ dryKg: slice.allocatedDryMassKg })));
    const carry = removalEntryCarryOwner({ entry: resolved, organizationId: ctx.organizationId, facilityId,
      fullyApplied: candidates.some(row => row.entry.id === entry.id) && !!batch.endDate && batch.endDate < facilityToday(timezone) && mass.notAppliedDryKg === 0,
      ownContenders, contenders, observation });
    const holdingId = entry.sentByRemovalId ?? (retained ? reservation.removalId : null);
    const holding = removals.find(removal => removal.id === holdingId);
    const heldMembers = memberships.filter(member => member.removalId === holdingId).map(member => member.batch);
    const destination = holding ? { removalId: holding.id, removalCode: holding.code, creditBatchCodes: [...new Set(heldMembers.map(member => member.code))].sort(),
      anotherCreditBatch: !heldMembers.some(member => member.id === entry.creditBatchId) } : null;
    if (retained && destination?.anotherCreditBatch) carry.receiver = destination;
    const earlier = attempts.filter(attempt => attempt.submittedAt && attempt.submittedAt <= entry.createdAt && slices.some(slice => slice.creditBatchId === entry.creditBatchId && slice.removalId === attempt.localEntityId))
      .sort((a, b) => b.submittedAt!.getTime() - a.submittedAt!.getTime() || a.id.localeCompare(b.id))[0];
    return [{ ...resolved, carry, reportedIn: entry.sentByRemovalId ? destination : null,
      earlierRemovalCode: removals.find(removal => removal.id === earlier?.localEntityId)?.code,
      earlierRemovalId: removals.find(removal => removal.id === earlier?.localEntityId)?.id,
      creditBatchCode: batch.code, entryObservation: observation }];
  });
  return { entries, contenders, ownContenders, batches: [...new Map(selected.map(row => [row.batch.id, row.batch])).values()] };
}

type CarryEntry = ReturnType<typeof deriveEmissionEntryFacts>[number] & {
  reservedByRemovalId: string | null; reservationKnownInactive: boolean;
  carry: ReturnType<typeof removalEntryCarryOwner>; reportedIn: EntryCarryDestination | null;
  earlierRemovalCode: string | undefined; earlierRemovalId?: string; creditBatchCode: string;
  entryObservation: Awaited<ReturnType<typeof getTemplateObservationsByIds>>[number];
};

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
