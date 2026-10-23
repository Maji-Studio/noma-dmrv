import type { OrgContext } from "@/lib/auth/server";
import { isCarriedToRemoval } from "@/lib/certification/emission-entry-carry";
import { emissionEntryCounts, entryLine } from "@/lib/certification/emission-entry-rules";
import { deriveRemovalEntryInputs } from "@/lib/certification/removal-entry-inputs";
import { deriveRemovalEntryWindow, entryHoldingRemovalId } from "@/lib/certification/removal-emission-contributions";
import { frozenEntriesForAttempt } from "@/lib/certification/frozen-removal-entries";
import { mergeEntryCarryFacts } from "@/lib/certification/merge-entry-carry-facts";
import { requireOrgScope } from "./utils";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { getLatestTemplateObservations } from "./removal-template-observations";
import { listEmissionEntryDraftContenders, loadEmissionEntryReservations } from "./emission-entry-contenders";
import { getLatestSubmission } from "./certification-submissions";

/** Same entry selection as the full context, without transport, registry templates or evidence rendering. */
export async function loadDraftRemovalCarriedEntries(ctx: OrgContext, removalId: string, facilityId: string) {
  requireOrgScope(ctx);
  const batches = await getCreditBatchesByRemovalId(ctx, removalId);
  const ids = batches.map(batch => batch.id);
  const observations = await getLatestTemplateObservations(ctx, "isometric", [...new Set(batches.flatMap(batch => batch.removalTemplateId ? [batch.removalTemplateId] : []))]);
  const observation = observations.find(item => item.externalTemplateId === batches[0]?.removalTemplateId);
  if (!observation) return [];
  const readableBatches = batches.filter(batch => observations.some(item => item.externalTemplateId === batch.removalTemplateId));
  const [carry, rollups, facts, contenders, latest] = await Promise.all([
    loadFacilityEmissionEntryCarry(ctx, facilityId, undefined, undefined, { ownedRemovalId: removalId }),
    loadCreditBatchRollups(ctx, ids, { removalId }),
    Promise.all(readableBatches.map(async batch => {
      const current = observations.find(item => item.externalTemplateId === batch.removalTemplateId);
      return current ? loadBatchEmissionEntryFacts(ctx, batch.id, current) : null;
    })),
    listEmissionEntryDraftContenders(ctx, readableBatches.map(batch => batch.id)),
    getLatestSubmission(ctx, { provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: removalId }),
  ]);
  const carried = carry.entries.filter(entry => !ids.includes(entry.creditBatchId) && isCarriedToRemoval(entry, removalId))
    .map(entry => ({ ...entry, ...emissionEntryCounts(entry.entryObservation, observation, entry.componentId) }));
  const own = mergeEntryCarryFacts(facts.flatMap(fact => fact?.entries ?? []), carry.entries);
  const allEntries = [...own, ...carried];
  let frozen = frozenEntriesForAttempt(latest, { carryContext: carry, batchFacts: Object.fromEntries(readableBatches.map(batch => [batch.id, {
    entries: own.filter(entry => entry.creditBatchId === batch.id),
    productionReservationSubmissionId: rollups[batch.id]?.batch.productionEmissionsClaimReservedBySubmissionId,
  }])) });
  if (frozen?.some(item => !allEntries.some(entry => entry.id === item.entryId && entry.contentRevision === item.contentRevision && !entry.deletedAt))) frozen = undefined;
  const entries = allEntries.filter(entry => !frozen || frozen.some(item => item.entryId === entry.id) ||
    entry.kind === "value" && entry.lineRule === "single" && !!entryHoldingRemovalId(entry) && entryHoldingRemovalId(entry) !== removalId);
  const reservations = await loadEmissionEntryReservations(ctx, [...new Set(entries.flatMap(entry => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []))]);
  const contributions = deriveRemovalEntryInputs({ removalId, memberBatchIds: ids, observation, contenders, entries,
    reservations, nowMs: Date.now(), frozen: !!frozen,
    window: deriveRemovalEntryWindow(batches, Object.values(rollups).flatMap(rollup => rollup.lineageFacts.applications.map(application => application.applicationDate))),
  });
  return carried.filter(entry => contributions.selectedEntryIds.includes(entry.id)).map(entry => ({
    entryId: entry.id, creditBatchId: entry.creditBatchId, creditBatchCode: entry.creditBatchCode,
    componentId: entry.componentId, componentName: entryLine(observation, entry.componentId)?.component.displayName,
    occurredOn: entry.occurredOn, value: entry.values[0], evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
    earlierRemovalId: entry.earlierRemovalId, earlierRemovalCode: entry.earlierRemovalCode,
  })).sort((a, b) => a.entryId.localeCompare(b.entryId));
}
