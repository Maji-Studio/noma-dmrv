import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, creditBatchApplications, certifierRemovals, certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { creditBatchApplicationMass } from "@/lib/credit-batches/application-mass";
import { removalEntryCarryOwner, type CarryContender } from "@/lib/certification/emission-entry-carry";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { isLiveEntryReservation } from "@/lib/certification/removal-emission-contributions";
import { requireOrgScope } from "./utils";
import { listEmissionEntryDraftContenders, loadEmissionEntryReservations } from "./emission-entry-contenders";
import { listEmissionEntriesForBatches } from "./emission-entries";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { getLatestTemplateObservation, getTemplateObservationsByIds } from "./removal-template-observations";

type CarryExecutor = typeof db | DbTransaction;

/** Facility-scoped contenders and origin facts, also used inside the reservation transaction. */
export async function loadFacilityEmissionEntryCarry(
  ctx: OrgContext, facilityId: string, executor: CarryExecutor = db,
  claimedAttempt?: { removalId: string; submissionId?: string },
) {
  requireOrgScope(ctx);
  const batches = await executor.select().from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId),
  ));
  const batchIds = batches.map(batch => batch.id);
  const [stored, ownContenders, removals] = await Promise.all([
    listEmissionEntriesForBatches(ctx, batchIds, executor),
    listEmissionEntryDraftContenders(ctx, batchIds, executor, claimedAttempt),
    executor.select().from(certifierRemovals).where(and(
      eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.facilityId, facilityId),
    )),
  ]);
  const removalIds = removals.map(removal => removal.id);
  const memberships = removalIds.length ? await executor.select({ removalId: creditBatchApplications.removalId, batchId: creditBatchApplications.creditBatchId })
    .from(creditBatchApplications).innerJoin(creditBatches, and(eq(creditBatches.id, creditBatchApplications.creditBatchId),
      eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)))
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.removalId, removalIds))) : [];
  const attempts = removalIds.length ? await executor.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId),
    eq(certificationSubmissions.provider, "isometric"), eq(certificationSubmissions.localEntityType, "removal"),
    eq(certificationSubmissions.submissionType, "removal"), inArray(certificationSubmissions.localEntityId, removalIds),
  )) : [];
  const templateIds = [...new Set(batches.flatMap(batch => batch.removalTemplateId ? [batch.removalTemplateId] : []))];
  const observations = await Promise.all(templateIds.map(id => getLatestTemplateObservation(ctx, "isometric", id, executor)));
  const previous = await getTemplateObservationsByIds(ctx, stored.map(entry => entry.observationId), executor);
  const previousById = new Map(previous.map(observation => [observation.id, observation]));
  const nowMs = Date.now();
  const contenders: CarryContender[] = ownContenders.flatMap(contender => {
    const removal = removals.find(row => row.id === contender.removalId);
    const members = batches.filter(batch => contender.creditBatchIds.includes(batch.id));
    const pins = new Set(members.map(batch => batch.removalTemplateId));
    const blocked = attempts.some(attempt => attempt.localEntityId === contender.removalId &&
      (attempt.submittedAt || attempt.status === "submitted" || attempt.status === "accepted" ||
        (attempt.id !== claimedAttempt?.submissionId && isLiveEntryReservation(attempt, nowMs))));
    if (!removal || contender.contenderKind !== "draft" || blocked || pins.size !== 1 || !members.length || members.length !== new Set(contender.creditBatchIds).size) return [];
    return [{ ...contender, organizationId: ctx.organizationId, facilityId, code: removal.code,
      creditBatchCodes: members.map(batch => batch.code).sort(),
      observation: observations.find(observation => observation?.externalTemplateId === members[0].removalTemplateId) ?? null }];
  });
  const originIds = [...new Set(stored.map(entry => entry.creditBatchId))];
  const [rollups, slices, reservations] = await Promise.all([
    loadCreditBatchRollups(ctx, originIds, undefined, executor),
    originIds.length ? executor.select({ creditBatchId: creditBatchApplications.creditBatchId, dryKg: creditBatchApplications.allocatedDryMassKg })
      .from(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, originIds))) : [],
    loadEmissionEntryReservations(ctx, stored.flatMap(entry => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []), executor),
  ]);
  const entries = stored.flatMap(entry => {
    const batch = batches.find(batch => batch.id === entry.creditBatchId)!;
    const observation = previousById.get(entry.observationId) ?? null;
    if (!observation) return [];
    const [fact] = deriveEmissionEntryFacts([entry], observation, previousById);
    const reservation = reservations.find(row => row.submissionId === entry.sendReservedBySubmissionId);
    const live = reservation && isLiveEntryReservation(reservation, nowMs);
    const resolved = { ...fact, reservedByRemovalId: live ? reservation.removalId : null, reservationKnownInactive: !entry.sendReservedBySubmissionId || !!reservation && !live };
    const mass = creditBatchApplicationMass(rollups[batch.id]?.lineageFacts.runs ?? [], slices.filter(slice => slice.creditBatchId === batch.id));
    const carry = removalEntryCarryOwner({ entry: resolved, organizationId: ctx.organizationId, facilityId,
      fullyApplied: mass.notAppliedDryKg === 0, ownContenders, contenders, observation });
    const holdingId = entry.sentByRemovalId ?? (live ? reservation.removalId : null);
    const holding = holdingId ? removals.find(removal => removal.id === holdingId) : null;
    // Persisted ownership wins even if the receiver is no longer a contender.
    const heldMembers = memberships.filter(member => member.removalId === holdingId).map(member => member.batchId);
    const destination = holding ? { removalId: holding.id, removalCode: holding.code,
      creditBatchCodes: batches.filter(batch => heldMembers.includes(batch.id)).map(batch => batch.code).sort(),
      anotherCreditBatch: !heldMembers.includes(entry.creditBatchId) } : null;
    const reportedIn = entry.sentByRemovalId ? destination : null;
    if (live && destination?.anotherCreditBatch) carry.receiver = destination;
    const earlier = attempts.filter(attempt => attempt.submittedAt && attempt.submittedAt <= entry.createdAt &&
      memberships.some(member => member.batchId === entry.creditBatchId && member.removalId === attempt.localEntityId))
      .sort((a, b) => b.submittedAt!.getTime() - a.submittedAt!.getTime() || a.id.localeCompare(b.id))[0];
    const earlierRemovalCode = removals.find(removal => removal.id === earlier?.localEntityId)?.code;
    return [{ ...resolved, carry, reportedIn, earlierRemovalCode, creditBatchCode: batch.code, entryObservation: observation }];
  });
  return { entries, contenders, ownContenders, batches };
}

/** Batch display reads discover facilities only through organization-scoped batches. */
export async function loadBatchEmissionEntryCarry(ctx: OrgContext, batchIds: string[]) {
  requireOrgScope(ctx);
  if (!batchIds.length) return [];
  const batches = await db.select({ facilityId: creditBatches.facilityId }).from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.id, batchIds),
  ));
  const contexts = await Promise.all([...new Set(batches.map(batch => batch.facilityId))]
    .map(facilityId => loadFacilityEmissionEntryCarry(ctx, facilityId)));
  return contexts.flatMap(context => context.entries).filter(entry => batchIds.includes(entry.creditBatchId));
}
