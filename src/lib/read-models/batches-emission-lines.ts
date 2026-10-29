import type { LateEntryFacts } from "@/lib/certification/late-entry-view";
import { mergeEntryCarryFacts } from "@/lib/certification/merge-entry-carry-facts";
import { loadBatchEmissionEntryCarry } from "@/data-access/emission-entry-carry";
import type { OrgContext } from "@/lib/auth/server";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { listEmissionLineCommentsForBatches } from "@/data-access/emission-line-comments";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import { deriveBatchEmissionLines } from "@/lib/certification/emission-lines";
import { withRemovedEntryComponents } from "@/lib/certification/emission-line-definition";
import { isEnrichmentComplete, validateLineSources } from "@/lib/isometric/template-observations";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import type { BatchEmissionLineFacts } from "@/lib/certification/emission-lines";

export type BatchEmissionLinesResult =
  | { status: "ready"; lines: ReturnType<typeof buildBatchEmissionLines>; storedEntries: StoredEntries }
  | { status: "blocked"; blocker: "unpinnedTemplate" | "templateNotFullyRead"; storedEntries: StoredEntries };

type StoredEntries = Awaited<ReturnType<typeof listEmissionEntriesForBatches>>;

/** Shared display read for an already authorized set of batches. */
export async function loadBatchesEmissionLines(
  ctx: OrgContext,
  batches: readonly { id: string; removalTemplateId: string | null }[],
  { comments = false }: { comments?: boolean } = {},
): Promise<Map<string, BatchEmissionLinesResult>> {
  if (!batches.length) return new Map();
  const ids = batches.map((batch) => batch.id);
  const templateIds = [...new Set(batches.flatMap((batch) => batch.removalTemplateId ? [batch.removalTemplateId] : []))];
  const [observations, storedEntries] = await Promise.all([
    getLatestTemplateObservations(ctx, "isometric", templateIds),
    listEmissionEntriesForBatches(ctx, ids),
  ]);
  const byTemplate = new Map(observations.map((observation) => [observation.externalTemplateId, observation]));
  // Missing observations block the batch; incomplete enrichment produces display lines with review blockers.
  const readyIds = batches.filter((batch) => batch.removalTemplateId && byTemplate.has(batch.removalTemplateId)).map((batch) => batch.id);
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  const readyIdSet = new Set(readyIds);
  const previousIds = [...new Set(storedEntries.filter((entry) => readyIdSet.has(entry.creditBatchId))
    .map((entry) => entry.observationId))].filter((id) => !byId.has(id));
  const [previous, automatic, storedComments, carryEntries] = await Promise.all([
    getTemplateObservationsByIds(ctx, previousIds),
    loadBatchesEmissionAutomaticFacts(ctx, readyIds),
    comments && readyIds.length ? listEmissionLineCommentsForBatches(ctx, readyIds) : [],
    loadBatchEmissionEntryCarry(ctx, readyIds),
  ]);
  for (const observation of previous) byId.set(observation.id, observation);
  const entriesByBatch = new Map<string, typeof storedEntries>();
  for (const entry of storedEntries) {
    const list = entriesByBatch.get(entry.creditBatchId) ?? [];
    list.push(entry);
    entriesByBatch.set(entry.creditBatchId, list);
  }
  const commentsByBatch = new Map<string, typeof storedComments>();
  for (const comment of storedComments) {
    const list = commentsByBatch.get(comment.creditBatchId) ?? [];
    list.push(comment);
    commentsByBatch.set(comment.creditBatchId, list);
  }
  return new Map(batches.map((batch): readonly [string, BatchEmissionLinesResult] => {
    const observation = batch.removalTemplateId ? byTemplate.get(batch.removalTemplateId) : undefined;
    const stored = entriesByBatch.get(batch.id) ?? [];
    if (!batch.removalTemplateId) return [batch.id, { status: "blocked", blocker: "unpinnedTemplate", storedEntries: stored }];
    if (!observation) return [batch.id, { status: "blocked", blocker: "templateNotFullyRead", storedEntries: stored }];
    const entries = mergeEntryCarryFacts(deriveEmissionEntryFacts(stored, observation, byId), carryEntries);
    const lines = buildBatchEmissionLines(observation, entries, byId, automatic[batch.id], commentsByBatch.get(batch.id));
    return [batch.id, { status: "ready", lines, storedEntries: stored }];
  }));
}

/** The same display derivation is used by the detail page and facility overview. */
export function buildBatchEmissionLines(
  observation: EntryObservation,
  entries: readonly (ReturnType<typeof deriveEmissionEntryFacts>[number] & LateEntryFacts)[],
  previousObservations: ReadonlyMap<string, EntryObservation | null>,
  automaticFacts: Pick<BatchEmissionLineFacts, "automaticFigures" | "automaticRecordCounts" | "feedstockTransportCountedOn">,
  comments: Awaited<ReturnType<typeof listEmissionLineCommentsForBatches>> = [],
) {
  const currentComponents = new Set(observation.definition.groups.flatMap((group) => group.components.map((component) => component.id)));
  const commentsByComponent = new Map(comments.map((comment) => [comment.componentId, comment]));
  const definition = withRemovedEntryComponents(observation.definition, entries, previousObservations);
  return deriveBatchEmissionLines({
    definition,
    lineSources: observation.lineSources,
    problems: validateLineSources(observation.definition, observation.lineSources),
    enrichmentComplete: isEnrichmentComplete(observation.definition, observation.enrichment),
    ...automaticFacts,
    entries,
  }).map((line) => {
    const component = definition.groups
      .flatMap((group) => group.components)
      .find((component) => component.id === line.componentId)!;
    const inputShape = component.inputs
      .filter((input) => input.type === "monitored")
      .map((input) => {
        const enriched = observation.enrichment[component.id]?.[input.key];
        return {
          ...input,
          unit:
            enriched && !("status" in enriched)
              ? (canonicalUnit(input.quantityKind, enriched.unit) ?? null)
              : null,
        };
      });
    // Retired entry components remain visible for re-entry, but their comments do not.
    const removedFromTemplate = !currentComponents.has(line.componentId);
    const comment = removedFromTemplate ? undefined : commentsByComponent.get(line.componentId);
    return {
      ...line,
      label: line.displayName,
      description: component.description,
      inputShape,
      unit: inputShape.length === 1 ? inputShape[0].unit : null,
      entryPolicy: line.contract?.entryPolicy ?? "none",
      entries: entries.filter((entry) => entry.componentId === line.componentId),
      removedFromTemplate,
      comment: comment ? {
        id: comment.id, body: comment.body, version: comment.version,
        updatedAt: comment.updatedAt, updatedBy: comment.updatedBy,
      } : null,
    };
  });
}
