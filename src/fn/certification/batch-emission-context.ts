import { coversBatches, type CoveredContenders } from "@/lib/certification/covered-contenders";
import { mergeEntryCarryFacts } from "@/lib/certification/merge-entry-carry-facts";
import { loadFacilityEmissionEntryCarry } from "@/data-access/emission-entry-carry";
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

export interface LoadedBatchEmissionContext {
  batchFacts: BatchEmissionContext;
  carryContext?: Awaited<ReturnType<typeof loadFacilityEmissionEntryCarry>>;
}

export interface BatchEmissionContextOptions {
  /** An attempt may include its own reservations in eligibility. */
  claimedAttempt?: { removalId: string; submissionId?: string };
  /** Optional advisory projection; omitted for comparison to prevent recursion. */
  loadCorrection?: (ctx: OrgContext, removalId: string, coveredContenders: CoveredContenders) => Promise<EntryCorrectionState>;
  /** Request-scoped facility carry discovery cache. */
  carryReads?: Map<string, ReturnType<typeof loadFacilityEmissionEntryCarry>>;
  /** Include persisted entries owned by this Removal. */
  ownedRemovalId?: string;
  /** Reuse the outer authorized correction window instead of refreshing it. */
  coveredContenders?: CoveredContenders;
}

/** Batch-wide facts, even when the Removal carries only some applications. */
export async function loadBatchEmissionContext(
  ctx: OrgContext, facilityId: string,
  batches: readonly { id: string; removalTemplateId: string | null }[],
  facilityFacts: EntryTemplateContext,
  { claimedAttempt, loadCorrection, carryReads, ownedRemovalId, coveredContenders }: BatchEmissionContextOptions = {},
): Promise<LoadedBatchEmissionContext> {
  const result: BatchEmissionContext = {};
  const readableBatches = batches.flatMap((batch) => {
    const observation = batch.removalTemplateId
      ? facilityFacts.templatesById[batch.removalTemplateId]?.observation : null;
    return observation ? [{ ...batch, observation }] : [];
  });
  if (!readableBatches.length) return { batchFacts: result };
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
    coversBatches(coveredContenders, ids, claimedAttempt) ? coveredContenders.contenders : listEmissionEntryDraftContenders(ctx, ids, undefined, claimedAttempt),
    listEmissionEntryAvailableApplications(ctx, ids),
  ]);
  const carryKey = JSON.stringify([ctx.organizationId, facilityId, claimedAttempt]);
  let carryRead = carryReads?.get(carryKey);
  if (!carryRead) {
    carryRead = loadFacilityEmissionEntryCarry(ctx, facilityId, undefined, claimedAttempt, carryReads ? {} : { ownedRemovalId });
    carryReads?.set(carryKey, carryRead);
  }
  const discovered = await carryRead;
  const owned = carryReads && ownedRemovalId
    ? await loadFacilityEmissionEntryCarry(ctx, facilityId, undefined, claimedAttempt, { ownedRemovalId }, true) : null;
  const carryContext = owned ? { ...discovered,
    entries: [...new Map([...owned.entries, ...discovered.entries].map(entry => [entry.id, entry])).values()],
    batches: [...new Map([...owned.batches, ...discovered.batches].map(batch => [batch.id, batch])).values()],
  } : discovered;
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
    const entries = mergeEntryCarryFacts(deriveEmissionEntryFacts(stored, observation, previousObservations), carryContext.entries);
    result[id] = { productionReservationSubmissionId: rollups[id].batch.productionEmissionsClaimReservedBySubmissionId, entries, previousObservations, automaticFigures: automatic[id].automaticFigures, contenders,
      entriesWithoutRemoval: entriesWithoutRemoval(entries, contenders, liveReservationIds, availableApplications) };
  }
  for (const contender of contenders.filter((item) => loadCorrection && item.contenderKind === "correction")) {
    const correction = await loadCorrection!(ctx, contender.removalId, { contenders, batchIds: ids, claimedAttempt });
    for (const id of correction.correction?.batches.map((batch) => batch.id) ?? correction.changedBatchIds ?? []) {
      if (result[id]) (result[id].corrections ??= []).push({ ...correction,
        correction: correction.correction ? { ...correction.correction,
          changed: correction.correction.changed.filter((change) => change.batchId === id),
        } : undefined,
      });
    }
  }
  return { batchFacts: result, carryContext };
}
