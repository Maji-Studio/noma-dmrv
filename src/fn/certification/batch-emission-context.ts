import { loadRemovalEntryCorrection } from "./removal-correction-core";
import type { EntryCorrectionState } from "@/lib/certification/removal-entry-correction";
import { listEmissionEntryDraftContenders, listEmissionEntryAvailableApplications, loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import { isLiveEntryReservation, entriesWithoutRemoval, type EntryContender } from "@/lib/certification/removal-emission-contributions";
import type { OrgContext } from "@/lib/auth/server";
import type { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { requireOrgFacility } from "@/data-access/utils";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { SafeError } from "@/lib/errors";
import type { BatchEmissionLineFacts } from "@/lib/certification/emission-lines";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";

/** Entry derivation only needs persisted observations, never registry facts. */
export interface EntryTemplateContext {
  templatesById: Partial<Record<string, { observation: RemovalTemplateObservation | null }>>;
}

export type BatchEmissionContext = Record<string,
  Pick<BatchEmissionLineFacts, "automaticFigures" | "omittedAutomaticSources"> & Awaited<ReturnType<typeof loadBatchEmissionEntryFacts>> & { corrections?: EntryCorrectionState[]; productionReservationSubmissionId?: string | null; contenders?: EntryContender[]; entriesWithoutRemoval?: string[] }>;

/** Batch-wide facts, even when the Removal carries only some applications. */
export async function loadBatchEmissionContext(
  ctx: OrgContext, facilityId: string,
  batches: readonly { id: string; removalTemplateId: string | null }[],
  facilityFacts: EntryTemplateContext,
  claimedAttempt?: { removalId: string; submissionId?: string },
  includeCorrections = true,
): Promise<BatchEmissionContext> {
  const result: BatchEmissionContext = {};
  const readableBatches = batches.flatMap((batch) => {
    const observation = batch.removalTemplateId
      ? facilityFacts.templatesById[batch.removalTemplateId]?.observation : null;
    return observation ? [{ ...batch, observation }] : [];
  });
  if (!readableBatches.length) return result;
  const ids = readableBatches.map((batch) => batch.id);
  // The automatic bulk loader enforces organization scope, but not facility scope.
  // Read the batches together to retain the single-batch loader's facility guard.
  await requireOrgFacility(ctx, facilityId);
  const rollups = await loadCreditBatchRollups(ctx, ids);
  for (const id of ids) {
    if (rollups[id]?.batch.facilityId !== facilityId) throw new SafeError("Credit batch was not found.");
  }
  const [storedEntries, automatic, contenders, availableApplications] = await Promise.all([
    listEmissionEntriesForBatches(ctx, ids),
    loadBatchesEmissionAutomaticFacts(ctx, ids),
    listEmissionEntryDraftContenders(ctx, ids, undefined, claimedAttempt, !claimedAttempt),
    listEmissionEntryAvailableApplications(ctx, ids),
  ]);
  const reservations = await loadEmissionEntryReservations(ctx, [...new Set(storedEntries.flatMap((entry) => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []))]);
  const liveReservationIds = new Set(reservations.filter((row) => isLiveEntryReservation(row, Date.now())).map((row) => row.submissionId));
  const observationsById = new Map(readableBatches.map(({ observation }) => [observation.id, observation]));
  const previousIds = [...new Set(storedEntries.map((entry) => entry.observationId))]
    .filter((id) => !observationsById.has(id));
  const previous = await getTemplateObservationsByIds(ctx, previousIds);
  for (const observation of previous) observationsById.set(observation.id, observation);
  const entriesByBatch = new Map<string, typeof storedEntries>();
  for (const entry of storedEntries) {
    const stored = entriesByBatch.get(entry.creditBatchId) ?? [];
    stored.push(entry);
    entriesByBatch.set(entry.creditBatchId, stored);
  }
  for (const { id, observation } of readableBatches) {
    const stored = entriesByBatch.get(id) ?? [];
    const previousObservations = new Map(stored.map((entry) =>
      [entry.observationId, observationsById.get(entry.observationId) ?? null] as const,
    ));
    const entries = deriveEmissionEntryFacts(stored, observation, previousObservations);
    result[id] = { productionReservationSubmissionId: rollups[id].batch.productionEmissionsClaimReservedBySubmissionId, entries, previousObservations, automaticFigures: automatic[id].automaticFigures, contenders,
      entriesWithoutRemoval: entriesWithoutRemoval(entries, contenders, liveReservationIds, availableApplications) };
  }
  for (const contender of contenders.filter((item) => includeCorrections && item.contenderKind === "correction")) {
    const correction = await loadRemovalEntryCorrection(ctx, contender.removalId, contenders);
    for (const id of correction.correction?.batches.map((batch) => batch.id) ?? correction.changedBatchIds ?? []) {
      if (result[id]) (result[id].corrections ??= []).push({ ...correction,
        correction: correction.correction ? { ...correction.correction,
          changed: correction.correction.changed.filter((change) => change.batchId === id),
        } : undefined,
      });
    }
  }
  return result;
}
