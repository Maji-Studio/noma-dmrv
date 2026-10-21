import { EMISSION_ENTRIES_CHANGED } from "@/lib/certification/emission-entry-messages";
import type { certificationSubmissions } from "@/db/schema/certification";
import { readRemovalEntrySnapshot } from "@/lib/certification/removal-entry-snapshot";
import { getMetadataValue, SUBMISSION_METADATA_KEYS, SUBMISSION_EXTERNAL_MUTATIONS } from "@/lib/certification/submission-metadata";
import { omittedProductionSources } from "@/lib/certification/removal-emission-lines";
import type { OrgContext } from "@/lib/auth/server";
import { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import { deriveRemovalEntryWindow, entryHoldingRemovalId } from "@/lib/certification/removal-emission-contributions";
import { deriveRemovalEntryInputs } from "@/lib/certification/removal-entry-inputs";
import type { BatchEmissionContext, EntryTemplateContext } from "./batch-emission-context";
import type { RemovalScope } from "./removal-scope";

export async function loadRemovalEntryContext(ctx: OrgContext, scope: RemovalScope, facts: BatchEmissionContext, facility: EntryTemplateContext, frozenEntrySet?: { entryId: string; contentRevision: number }[]) {
  if (!scope.removalId) return undefined;
  const observation = facility.templatesById[scope.memberBatches[0]?.removalTemplateId ?? ""]?.observation;
  if (!observation) return undefined;
  const allEntries = Object.values(facts).flatMap((batch) => batch.entries);
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
    creditBatchCodes: Object.fromEntries(scope.memberBatches.map((batch) => [batch.id, batch.code])),
    contenders, entries, reservations, nowMs: Date.now(), frozen: !!frozenEntrySet, observation,
    entriesWithoutRemoval: frozenEntrySet ? [] : Object.values(facts).flatMap((batch) => batch.entriesWithoutRemoval ?? []),
  });
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

/** A crashed, unreserved draft must not hide fresh facts from reads or the resume gate. */
export function frozenEntriesForAttempt(submission: typeof certificationSubmissions.$inferSelect | null, facts: BatchEmissionContext) {
  if (!submission || submission.status !== "draft" || !submission.payloadSnapshot ||
    typeof submission.payloadSnapshot !== "object" || !("frozenEntrySet" in submission.payloadSnapshot)) return undefined;
  const frozen = readRemovalEntrySnapshot(submission).frozenEntrySet;
  const entries = Object.values(facts).flatMap((batch) => batch.entries);
  // Both claim sets commit together, so production ownership also freezes an empty entry set.
  const productionReserved = Object.values(facts).some((batch) => batch.productionReservationSubmissionId === submission.id);
  const reserved = productionReserved || frozen.length > 0 && frozen.every((item) => entries.some((entry) =>
    entry.id === item.entryId && entry.sendReservedBySubmissionId === submission.id));
  const mutation = getMetadataValue(submission.metadata, SUBMISSION_METADATA_KEYS.externalMutation);
  return reserved || mutation === SUBMISSION_EXTERNAL_MUTATIONS.possible || mutation === SUBMISSION_EXTERNAL_MUTATIONS.confirmed ? frozen : undefined;
}
