import { selectRemovalEntries } from "@/lib/certification/removal-entry-selection";
import { ISOMETRIC_PROVIDER, REMOVAL_SUBMISSION_TYPE } from "@/lib/isometric/utils/constants";
import type { OrgContext } from "@/lib/auth/server";
import { frozenEntriesForAttempt } from "@/lib/certification/frozen-removal-entries";
import { mergeEntryCarryFacts } from "@/lib/certification/merge-entry-carry-facts";
import { requireOrgScope } from "./utils";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { getLatestTemplateObservations } from "./removal-template-observations";
import { listEmissionEntryDraftContenders, listEmissionEntryAvailableApplications, loadEmissionEntryReservations } from "./emission-entry-contenders";
import { getLatestSubmission } from "./certification-submissions";

/** Same entry selection as the full context, without transport, registry templates or evidence rendering. */
export async function loadDraftRemovalCarriedEntries(ctx: OrgContext, removalId: string, facilityId: string) {
  requireOrgScope(ctx);
  const batches = await getCreditBatchesByRemovalId(ctx, removalId);
  const ids = batches.map(batch => batch.id);
  const observations = await getLatestTemplateObservations(ctx, ISOMETRIC_PROVIDER, [...new Set(batches.flatMap(batch => batch.removalTemplateId ? [batch.removalTemplateId] : []))]);
  const observation = observations.find(item => item.externalTemplateId === batches[0]?.removalTemplateId);
  if (!observation) return [];
  const readableBatches = batches.filter(batch => observations.some(item => item.externalTemplateId === batch.removalTemplateId));
  const [carry, rollups, facts, contenders, latest, availableApplications] = await Promise.all([
    loadFacilityEmissionEntryCarry(ctx, facilityId, undefined, undefined, { ownedRemovalId: removalId }),
    loadCreditBatchRollups(ctx, ids, { removalId }),
    Promise.all(readableBatches.map(async batch => {
      const current = observations.find(item => item.externalTemplateId === batch.removalTemplateId);
      return current ? loadBatchEmissionEntryFacts(ctx, batch.id, current) : null;
    })),
    listEmissionEntryDraftContenders(ctx, readableBatches.map(batch => batch.id)),
    getLatestSubmission(ctx, { provider: ISOMETRIC_PROVIDER, submissionType: REMOVAL_SUBMISSION_TYPE, localEntityType: "removal", localEntityId: removalId }),
    listEmissionEntryAvailableApplications(ctx, ids),
  ]);
  const own = mergeEntryCarryFacts(facts.flatMap(fact => fact?.entries ?? []), carry.entries);
  const frozen = frozenEntriesForAttempt(latest, { carryContext: carry, batchFacts: Object.fromEntries(readableBatches.map(batch => [batch.id, {
    entries: own.filter(entry => entry.creditBatchId === batch.id),
    productionReservationSubmissionId: rollups[batch.id]?.batch.productionEmissionsClaimReservedBySubmissionId,
  }])) });
  const selection = selectRemovalEntries({ removalId, memberBatches: batches, observation, ownEntries: own,
    carryEntries: carry.entries, frozenEntrySet: frozen, contenders, availableApplications,
    applicationDates: Object.values(rollups).flatMap(rollup => rollup.lineageFacts.applications.map(application => application.applicationDate)),
  });
  const reservations = await loadEmissionEntryReservations(ctx, selection.reservationIds);
  return selection.derive(reservations, Date.now()).carriedEntries ?? [];
}
