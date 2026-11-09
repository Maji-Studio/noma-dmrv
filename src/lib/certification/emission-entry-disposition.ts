import type { creditBatches, creditBatchApplications, certifierRemovals, certificationSubmissions } from "@/db/schema";
import type { listCarryCandidates, listCarryRemovalMembers } from "@/data-access/emission-entry-carry-queries";
import type { hydrateEmissionEntries } from "@/data-access/emission-entries";
import type { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import type { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import type { getTemplateObservationsByIds, getLatestTemplateObservations } from "@/data-access/removal-template-observations";
import type { readRecordLockLineage } from "@/data-access/record-lock-lineage";
import type { loadPersistedEmissionCorrectionLineages } from "@/data-access/emission-entry-revisions";
import { facilityToday } from "@/lib/date-utils";
import { creditBatchApplicationMass, isCreditBatchFullyApplied } from "@/lib/credit-batches/application-mass";
import { removalEntryCarryOwner, type CarryContender, type EntryCarryDestination, type EntryRevisionDestination } from "@/lib/certification/emission-entry-carry";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { deriveRemovalEntryWindow, isLiveEntryReservation, removalEntryOwner } from "@/lib/certification/removal-emission-contributions";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";
import { readsAsCorrectionWindowOpenFromPersisted } from "@/lib/record-lock";
import type { EntryContender } from "@/lib/certification/removal-emission-contributions";

/** Loaded rows only. The caller supplies the clock for every temporal decision. */
export interface EmissionEntryDispositionInput {
  organizationId: string;
  facilityId: string;
  nowMs: number;
  claimedAttempt?: { removalId: string; submissionId?: string };
  candidates: Awaited<ReturnType<typeof listCarryCandidates>>;
  selected: Awaited<ReturnType<typeof listCarryCandidates>>;
  stored: Awaited<ReturnType<typeof hydrateEmissionEntries>>;
  draftMembers: Awaited<ReturnType<typeof listCarryRemovalMembers>>;
  originMembers: Awaited<ReturnType<typeof listCarryRemovalMembers>>;
  rollups: Awaited<ReturnType<typeof loadCreditBatchRollups>>;
  slices: (typeof creditBatchApplications.$inferSelect)[];
  previous: Awaited<ReturnType<typeof getTemplateObservationsByIds>>;
  reservations: Awaited<ReturnType<typeof loadEmissionEntryReservations>>;
  removals: (typeof certifierRemovals.$inferSelect)[];
  memberships: { removalId: string | null; batch: typeof creditBatches.$inferSelect }[];
  attempts: (typeof certificationSubmissions.$inferSelect)[];
  observations: Awaited<ReturnType<typeof getLatestTemplateObservations>>;
  lineage: Awaited<ReturnType<typeof readRecordLockLineage>>;
  correctionLineages: Awaited<ReturnType<typeof loadPersistedEmissionCorrectionLineages>>;
}

/** Persisted discovery and display facts, never authorization to correct a Removal. */
export function deriveEmissionEntryDisposition({
  organizationId, facilityId, nowMs, claimedAttempt, candidates, selected, stored,
  draftMembers, originMembers, rollups, slices, previous, reservations, removals,
  memberships, attempts, observations, lineage, correctionLineages,
}: EmissionEntryDispositionInput) {
  const contenders: CarryContender[] = [...new Set(draftMembers.map(row => row.removal.id))].flatMap(id => {
    const rows = draftMembers.filter(row => row.removal.id === id);
    const members = [...new Map(rows.map(row => [row.batch.id, row.batch])).values()].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const removal = rows[0].removal;
    const pins = new Set(members.map(batch => batch.removalTemplateId));
    const blocked = attempts.some(attempt => attempt.localEntityId === id && attempt.id !== claimedAttempt?.submissionId && isLiveEntryReservation(attempt, nowMs));
    const window = deriveRemovalEntryWindow(members, rows.map(row => row.applicationDate));
    if (blocked || !window || hasFreshRemovalDeletionLease(removal.metadata, nowMs) || pins.size !== 1 || members.some(batch => batch.facilityId !== facilityId)) return [];
    return [{ contenderKind: "draft" as const, removalId: id, createdAt: removal.createdAt.toISOString(), window,
      creditBatchIds: members.map(batch => batch.id), organizationId, facilityId, code: removal.code,
      creditBatchCodes: members.map(batch => batch.code),
      observation: observations.find(observation => observation.externalTemplateId === members[0].removalTemplateId) ?? null }];
  });
  // Persisted lineage cannot authorize corrections (that requires a fresh registry
  // read). Reserve their own windows conservatively instead of carrying entries
  // away while a returned or unknown covering statement might own them.
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
    const carry = removalEntryCarryOwner({ entry: resolved, organizationId, facilityId,
      fullyApplied: candidates.some(row => row.entry.id === entry.id) && !!batch.endDate && batch.endDate < facilityToday(timezone, new Date(nowMs)) && isCreditBatchFullyApplied(mass.notAppliedDryKg),
      ownContenders, contenders, observation });
    const holdingId = entry.sentByRemovalId ?? entry.heldForRemovalId ?? (retained ? reservation.removalId : null);
    const holding = removals.find(removal => removal.id === holdingId);
    const heldMembers = [...new Map(memberships.filter(member => member.removalId === holdingId).map(member => [member.batch.id, member.batch])).values()]
      .sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const destination = holding ? { removalId: holding.id, removalCode: holding.code, creditBatchCodes: heldMembers.map(member => member.code), creditBatchIds: heldMembers.map(member => member.id),
      anotherCreditBatch: !heldMembers.some(member => member.id === entry.creditBatchId) } : null;
    if ((retained || entry.heldForRemovalId) && destination?.anotherCreditBatch) carry.receiver = destination;
    const earlier = attempts.filter(attempt => attempt.submittedAt && attempt.submittedAt <= entry.createdAt && slices.some(slice => slice.creditBatchId === entry.creditBatchId && slice.removalId === attempt.localEntityId))
      .sort((a, b) => b.submittedAt!.getTime() - a.submittedAt!.getTime() || a.id.localeCompare(b.id))[0];
    // Display only: an uncertain conservative owner must not announce a returned revision.
    const ownerId = removalEntryOwner(resolved, ownContenders);
    const owner = ownContenders.find(contender => contender.removalId === ownerId && contender.contenderKind === "correction");
    const ownerLineage = correctionLineages.get(entry.creditBatchId);
    // Late against the elected owner's own sent attempt, not the batch's latest one.
    const ownerSentBefore = owner && attempts.some(attempt => attempt.localEntityId === owner.removalId && attempt.submittedAt && attempt.submittedAt <= entry.createdAt);
    const revisionRemoval = !entry.deletedAt && entry.kind === "value" && !entry.sentByRemovalId && !entry.heldForRemovalId &&
      !retained && resolved.reservationKnownInactive && ownerSentBefore && ownerLineage && readsAsCorrectionWindowOpenFromPersisted(owner.removalId, ownerLineage)
      ? removals.find(removal => removal.id === owner.removalId) : null;
    const revisionOf = revisionRemoval ? { removalId: revisionRemoval.id, removalCode: revisionRemoval.code } : null;
    return [{ ...resolved, ownerRemovalId: ownerId, revisionOf, carry, reportedIn: entry.sentByRemovalId ? destination : null,
      earlierRemovalCode: removals.find(removal => removal.id === earlier?.localEntityId)?.code,
      earlierRemovalId: removals.find(removal => removal.id === earlier?.localEntityId)?.id,
      creditBatchCode: batch.code, entryObservation: observation }];
  });
  return { entries, contenders, ownContenders, batches: [...new Map(selected.map(row => [row.batch.id, row.batch])).values()] };
}

export type CarryEntry = ReturnType<typeof deriveEmissionEntryFacts>[number] & {
  ownerRemovalId: string | null;
  reservedByRemovalId: string | null; reservationKnownInactive: boolean;
  carry: ReturnType<typeof removalEntryCarryOwner>; reportedIn: EntryCarryDestination | null;
  revisionOf: EntryRevisionDestination | null;
  earlierRemovalCode: string | undefined; earlierRemovalId?: string; creditBatchCode: string;
  entryObservation: Awaited<ReturnType<typeof getTemplateObservationsByIds>>[number];
};

