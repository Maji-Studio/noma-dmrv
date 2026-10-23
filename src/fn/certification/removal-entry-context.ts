import { isCarriedToRemoval } from "@/lib/certification/emission-entry-carry";
import { emissionEntryCounts, entryLine } from "@/lib/certification/emission-entry-rules";
import { EMISSION_ENTRIES_CHANGED } from "@/lib/certification/emission-entry-messages";
import { omittedProductionSources } from "@/lib/certification/removal-emission-lines";
import type { OrgContext } from "@/lib/auth/server";
import { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import { deriveRemovalEntryWindow, entryHoldingRemovalId } from "@/lib/certification/removal-emission-contributions";
import { deriveRemovalEntryInputs } from "@/lib/certification/removal-entry-inputs";
import type { BatchEmissionContext, LoadedBatchEmissionContext, EntryTemplateContext } from "./batch-emission-context";
import type { RemovalScope } from "./removal-scope";

export async function loadRemovalEntryContext(ctx: OrgContext, scope: RemovalScope, context: LoadedBatchEmissionContext, facility: EntryTemplateContext, frozenEntrySet?: { entryId: string; contentRevision: number }[]) {
  const { batchFacts: facts, carryContext } = context;
  if (!scope.removalId) return undefined;
  const observation = facility.templatesById[scope.memberBatches[0]?.removalTemplateId ?? ""]?.observation;
  if (!observation) return undefined;
  const carryEntries = carryContext?.entries ?? [];
  const memberIds = scope.memberBatches.map(batch => batch.id);
  const carriedEntries = carryEntries.filter(entry => !memberIds.includes(entry.creditBatchId) &&
    isCarriedToRemoval(entry, scope.removalId!))
    .map(entry => ({ ...entry, ...emissionEntryCounts(entry.entryObservation, observation, entry.componentId) }));
  const allEntries = [...Object.values(facts).flatMap((batch) => batch.entries), ...carriedEntries];
  const frozenChanged = frozenEntrySet && frozenEntrySet.some((frozen) => !allEntries.some((entry) => entry.id === frozen.entryId && entry.contentRevision === frozen.contentRevision && !entry.deletedAt));
  if (frozenChanged) frozenEntrySet = undefined;
  // Historical sent singles remain omission facts, even though they are not part of this attempt's frozen set.
  const belongsToFrozenView = (entry: (typeof allEntries)[number]) => !frozenEntrySet ||
    frozenEntrySet.some((frozen) => frozen.entryId === entry.id) ||
    (entry.kind === "value" && entry.lineRule === "single" && !!entryHoldingRemovalId(entry) && entryHoldingRemovalId(entry) !== scope.removalId);
  const entries = allEntries.filter(belongsToFrozenView);
  const contenders = Object.values(facts)[0]?.contenders ?? [];
  const reservations = await loadEmissionEntryReservations(ctx,
    [...new Set(entries.flatMap((entry) => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []))]);
  const contributions = deriveRemovalEntryInputs({
    removalId: scope.removalId, memberBatchIds: scope.memberBatches.map((batch) => batch.id),
    window: deriveRemovalEntryWindow(scope.memberBatches, scope.lineages.map((lineage) => lineage.application.applicationDate)),
    creditBatchCodes: Object.fromEntries([...scope.memberBatches.map((batch) => [batch.id, batch.code]), ...carriedEntries.map(entry => [entry.creditBatchId, entry.creditBatchCode])]),
    contenders, entries, reservations, nowMs: Date.now(), frozen: !!frozenEntrySet, observation,
    entriesWithoutRemoval: frozenEntrySet ? [] : Object.values(facts).flatMap((batch) => batch.entriesWithoutRemoval ?? []),
  });
  contributions.carriedEntries = carriedEntries.filter(entry => contributions.selectedEntryIds.includes(entry.id)).map(entry => ({
    entryId: entry.id, creditBatchCode: entry.creditBatchCode, creditBatchId: entry.creditBatchId, occurredOn: entry.occurredOn,
    componentId: entry.componentId, componentName: entryLine(observation, entry.componentId)?.component.displayName,
    value: entry.values[0], evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
    earlierRemovalCode: entry.earlierRemovalCode, earlierRemovalId: entry.earlierRemovalId,
  })).sort((a, b) => a.entryId.localeCompare(b.entryId));
  if (frozenChanged) contributions.blockers.push({ code: "lineNeedsReview", message: EMISSION_ENTRIES_CHANGED,
    fixTarget: "emissions", creditBatchId: scope.memberBatches[0].id });
  const batchFacts: BatchEmissionContext = Object.fromEntries(Object.entries(facts).map(([id, batch]) => {
    const member = scope.memberBatches.find((item) => item.id === id);
    const omittedAutomaticSources = omittedProductionSources(member?.productionEmissionsClaimedByRemovalId, scope.removalId!);
    return [id, { ...batch, ...(frozenEntrySet ? { entries: batch.entries.filter(belongsToFrozenView), entriesWithoutRemoval: [] } : {}), omittedAutomaticSources, automaticFigures: Object.fromEntries(
      Object.entries(batch.automaticFigures).filter(([source]) => !omittedAutomaticSources.some((id) => id === source)),
    ) }];
  }));
  return { contributions, batchFacts, observationId: observation.id, semanticFingerprint: observation.semanticFingerprint };
}

export { frozenEntriesForAttempt } from "@/lib/certification/frozen-removal-entries";
