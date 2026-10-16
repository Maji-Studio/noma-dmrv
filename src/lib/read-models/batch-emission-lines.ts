import { loadBatchAutomaticFigures } from "@/data-access/batch-emission-automatic-figures";
import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { requireOrgFacility } from "@/data-access/utils";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getLatestTemplateObservation } from "@/data-access/removal-template-observations";
import { resolveBatchPin } from "@/lib/certification/resolve-batch-pin";
import { deriveBatchEmissionLines } from "@/lib/certification/emission-lines";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { isEnrichmentComplete, validateLineSources } from "@/lib/isometric/template-observations";
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
  const automaticFigures = await loadBatchAutomaticFigures(ctx, facilityId, creditBatchId, { requireDeliveryMass: true });
  const { entries, previousObservations } = await loadBatchEmissionEntryFacts(ctx, creditBatchId, observation);
  const definition = structuredClone(observation.definition);
  // Keep removed-line entries visible for correction or deletion, with their original label.
  const present = new Set(
    definition.groups.flatMap((group) => group.components.map((component) => component.id)),
  );
  for (const entry of entries) {
    if (present.has(entry.componentId)) continue;
    const previous = previousObservations.get(entry.observationId);
    const group = previous?.definition.groups.find((group) =>
      group.components.some((component) => component.id === entry.componentId),
    );
    const component = group?.components.find((component) => component.id === entry.componentId);
    if (group && component) {
      definition.groups.push({ ...group, components: [component] });
      present.add(component.id);
    }
  }
  return deriveBatchEmissionLines({
    definition,
    lineSources: observation.lineSources,
    problems: validateLineSources(observation.definition, observation.lineSources),
    enrichmentComplete: isEnrichmentComplete(observation.definition, observation.enrichment),
    automaticFigures,
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
    return {
      ...line,
      label: line.displayName,
      description: component.description,
      inputShape,
      unit: inputShape.length === 1 ? inputShape[0].unit : null,
      entryPolicy: line.contract?.entryPolicy ?? "none",
      entries: entries.filter((entry) => entry.componentId === line.componentId),
    };
  });
}
