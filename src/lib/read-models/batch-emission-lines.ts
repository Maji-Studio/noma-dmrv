import { loadBatchEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { listEmissionLineComments } from "@/data-access/emission-line-comments";
import { requireOrgFacility } from "@/data-access/utils";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getLatestTemplateObservation } from "@/data-access/removal-template-observations";
import { resolveBatchPin } from "@/lib/certification/resolve-batch-pin";
import { deriveBatchEmissionLines } from "@/lib/certification/emission-lines";
import { withRemovedEntryComponents } from "@/lib/certification/emission-line-definition";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { isEnrichmentComplete, validateLineSources } from "@/lib/isometric/template-observations";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import type { BatchEmissionLineFacts } from "@/lib/certification/emission-lines";
import { SafeError } from "@/lib/errors";

/** Batch display facts only. A stored observation never authorizes submission. */
export async function loadBatchEmissionLines(ctx: OrgContext, facilityId: string, creditBatchId: string) {
  await requireOrgFacility(ctx, facilityId);
  const batch = await getCreditBatchById(ctx, creditBatchId, { skipPreview: true });
  if (!batch || batch.facilityId !== facilityId) throw new SafeError("Credit batch was not found.");
  const pin = resolveBatchPin([batch]);
  if ("code" in pin) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS[pin.code]);
  const observation = await getLatestTemplateObservation(ctx, "isometric", pin.pin);
  if (!observation) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
  const automaticFacts = await loadBatchEmissionAutomaticFacts(ctx, facilityId, creditBatchId, { requireDeliveryMass: true });
  const { entries, previousObservations } = await loadBatchEmissionEntryFacts(ctx, creditBatchId, observation);
  const comments = await listEmissionLineComments(ctx, creditBatchId);
  return buildBatchEmissionLines(observation, entries, previousObservations, automaticFacts, comments);
}

/** The same display derivation is used by the detail page and facility overview. */
export function buildBatchEmissionLines(
  observation: EntryObservation,
  entries: Awaited<ReturnType<typeof loadBatchEmissionEntryFacts>>["entries"],
  previousObservations: ReadonlyMap<string, EntryObservation | null>,
  automaticFacts: Pick<BatchEmissionLineFacts, "automaticFigures" | "automaticRecordCounts">,
  comments: Awaited<ReturnType<typeof listEmissionLineComments>> = [],
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
    const comment = currentComponents.has(line.componentId) ? commentsByComponent.get(line.componentId) : undefined;
    return {
      ...line,
      label: line.displayName,
      description: component.description,
      inputShape,
      unit: inputShape.length === 1 ? inputShape[0].unit : null,
      entryPolicy: line.contract?.entryPolicy ?? "none",
      entries: entries.filter((entry) => entry.componentId === line.componentId),
      comment: comment ? {
        id: comment.id, body: comment.body, version: comment.version,
        updatedAt: comment.updatedAt, updatedBy: comment.updatedBy,
      } : null,
    };
  });
}
