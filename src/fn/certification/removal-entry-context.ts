import { EMISSION_ENTRIES_CHANGED } from "@/lib/certification/emission-entry-messages";
import type { certificationSubmissions } from "@/db/schema/certification";
import { readRemovalEntrySnapshot } from "@/lib/certification/removal-entry-snapshot";
import { getMetadataValue, SUBMISSION_METADATA_KEYS, SUBMISSION_EXTERNAL_MUTATIONS } from "@/lib/certification/submission-metadata";
import { omittedProductionSources } from "@/lib/certification/removal-emission-lines";
import type { OrgContext } from "@/lib/auth/server";
import { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { deriveRemovalEntryContributions, deriveRemovalEntryWindow, isLiveEntryReservation } from "@/lib/certification/removal-emission-contributions";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import type { BatchEmissionContext } from "./batch-emission-context";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import type { RemovalScope } from "./removal-scope";

export async function loadRemovalEntryContext(ctx: OrgContext, scope: RemovalScope, facts: BatchEmissionContext, facility: FacilityCertifierFacts, frozenEntrySet?: { entryId: string; contentRevision: number }[]) {
  if (!emissionsEntriesEnabled() || !scope.removalId) return undefined;
  const observation = facility.templatesById[scope.memberBatches[0]?.removalTemplateId ?? ""]?.observation;
  if (!observation) return undefined;
  const allEntries = Object.values(facts).flatMap((batch) => batch.entries);
  const frozenChanged = frozenEntrySet && frozenEntrySet.some((frozen) => !allEntries.some((entry) => entry.id === frozen.entryId && entry.contentRevision === frozen.contentRevision && !entry.deletedAt));
  if (frozenChanged) frozenEntrySet = undefined;
  // Historical sent singles remain omission facts, even though they are not part of this attempt's frozen set.
  const belongsToFrozenView = (entry: (typeof allEntries)[number]) => !frozenEntrySet ||
    frozenEntrySet.some((frozen) => frozen.entryId === entry.id) ||
    (entry.kind === "value" && entry.lineRule === "single" && !!entry.sentByRemovalId && entry.sentByRemovalId !== scope.removalId);
  const entries = allEntries.filter(belongsToFrozenView);
  const contenders = Object.values(facts)[0]?.contenders ?? [];
  const reservations = await loadEmissionEntryReservations(ctx,
    [...new Set(entries.flatMap((entry) => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []))]);
  const nowMs = Date.now();
  const reservationOwners = new Map(reservations.map((reservation) => [reservation.submissionId, {
    removalId: reservation.removalId, live: isLiveEntryReservation(reservation, nowMs),
  }]));
  const contributions = deriveRemovalEntryContributions({
    removalId: scope.removalId, memberBatchIds: scope.memberBatches.map((batch) => batch.id),
    window: deriveRemovalEntryWindow(scope.memberBatches, scope.lineages.map((lineage) => lineage.application.applicationDate)),
    contenders, entries: entries.map((entry) => {
      const reservation = entry.sendReservedBySubmissionId ? reservationOwners.get(entry.sendReservedBySubmissionId) : undefined;
      return { ...entry, reservedByRemovalId: reservation?.live ? reservation.removalId : frozenEntrySet ? scope.removalId : null,
        reservationKnownInactive: !reservation?.live };
    }),
    entriesWithoutRemoval: frozenEntrySet ? [] : Object.values(facts).flatMap((batch) => batch.entriesWithoutRemoval ?? []),
    lineSources: observation.lineSources,
    monitoredInputs: observation.definition.groups.flatMap((group) => group.components.flatMap((component) => component.inputs.flatMap((input) => {
      if (input.type !== "monitored") return [];
      const enriched = observation.enrichment[component.id]?.[input.key];
      const unit = enriched && !("status" in enriched) ? canonicalUnit(input.quantityKind, enriched.unit) : undefined;
      return unit ? [{ componentId: component.id, inputKey: input.key, unit }] : [];
    }))),
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
  const reserved = frozen.length > 0 && frozen.every((item) => entries.some((entry) =>
    entry.id === item.entryId && entry.sendReservedBySubmissionId === submission.id));
  const mutation = getMetadataValue(submission.metadata, SUBMISSION_METADATA_KEYS.externalMutation);
  return reserved || mutation === SUBMISSION_EXTERNAL_MUTATIONS.possible || mutation === SUBMISSION_EXTERNAL_MUTATIONS.confirmed ? frozen : undefined;
}
