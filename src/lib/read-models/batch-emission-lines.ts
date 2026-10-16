import { emissionDeliveryShares } from "@/lib/certification/emission-delivery-shares";
import { requireOrgFacility } from "@/data-access/utils";
import { listEmissionEntries } from "@/data-access/emission-entries";
import { getTemplateObservationById } from "@/data-access/removal-template-observations";
import { emissionEntryCounts } from "@/lib/certification/emission-entry-rules";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import { batchAutomaticFigures } from "@/lib/certification/batch-automatic-figures";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
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
  const [rollups, runs, samples] = await Promise.all([
    loadCreditBatchRollups(ctx, [creditBatchId], { includeRunForwards: true }),
    getProductionRunsForCertification(ctx, batch.productionRunIds),
    getSamplesByCreditBatchIds(ctx, [creditBatchId]),
  ]);
  const lineage = rollups[creditBatchId]?.lineageFacts;
  if (!lineage) throw new SafeError("Credit batch accounting could not be loaded");
  const feedstockIds = [...new Set(lineage.runs.flatMap((run) => run.feedstocks.map((feedstock) => feedstock.id)))];
  // Run-forward slices include shipments not yet applied, and only this batch's share.
  const deliveries = emissionDeliveryShares(lineage.runForwards);
  const missingLoadMass = deliveries.find((delivery) => delivery.exactWetMassKg == null);
  if (missingLoadMass) throw new SafeError(`Delivery ${missingLoadMass.code} has no load mass. Add it before submitting.`);
  const [feedstock, biochar, sample] = await Promise.all([
    getTransportLegsForEntities(ctx, "feedstock", feedstockIds),
    loadBiocharDeliveryTransportLegs(ctx, deliveries.map((delivery) => ({ deliveryId: delivery.id, loadMassKg: Number(delivery.exactWetMassKg!) }))),
    getTransportLegsForEntities(ctx, "sample", samples.map((sample) => sample.id)),
  ]);
  const storedEntries = await listEmissionEntries(ctx, creditBatchId);
  const previousObservations = new Map(await Promise.all([...new Set(storedEntries.map(entry => entry.observationId))].map(async id => [id, await getTemplateObservationById(ctx, id)] as const)));
  const entries = storedEntries.map(entry => {
    const previous = previousObservations.get(entry.observationId);
    const status = previous ? emissionEntryCounts(previous, observation, entry.componentId) : { counts: false, reason: "Enter the values again for the current template line.", canConfirm: false };
    const value = entry.values.length === 1 ? entry.values[0] : null;
    return { ...entry, ...status, hasEvidence: entry.documentCount > 0, total: value ? { magnitude: value.magnitude, unit: value.unit } : null };
  });
  const exactMasses = await getEmissionAutomaticMasses(ctx, runs.map(run => run.id), [...feedstock, ...sample].map(leg => leg.id));
  // The transport projection accepts numbers; use the retained decimal shares for totals.
  for (const delivery of deliveries) exactMasses.legs[delivery.id] = delivery.exactWetMassKg;
  const definition = structuredClone(observation.definition);
  // Keep removed-line entries visible for correction or deletion, with their original label.
  const present = new Set(definition.groups.flatMap(group => group.components.map(component => component.id)));
  for (const entry of entries) {
    if (present.has(entry.componentId)) continue;
    const previous = previousObservations.get(entry.observationId);
    const group = previous?.definition.groups.find(group => group.components.some(component => component.id === entry.componentId));
    const component = group?.components.find(component => component.id === entry.componentId);
    if (group && component) { definition.groups.push({ ...group, components: [component] }); present.add(component.id); }
  }
  return deriveBatchEmissionLines({ definition, lineSources: observation.lineSources,
    problems: validateLineSources(observation.definition, observation.lineSources),
    enrichmentComplete: isEnrichmentComplete(observation.definition, observation.enrichment),
    automaticFigures: batchAutomaticFigures(runs, { feedstock, biochar, sample }, exactMasses), entries,
  }).map(line => {
    const component = definition.groups.flatMap(group => group.components).find(component => component.id === line.componentId)!;
    const inputShape = component.inputs.filter(input => input.type === "monitored").map(input => {
      const enriched = observation.enrichment[component.id]?.[input.key];
      return { ...input, unit: enriched && !("status" in enriched) ? canonicalUnit(input.quantityKind, enriched.unit) ?? null : null };
    });
    return { ...line, label: line.displayName, description: component.description, inputShape, unit: inputShape.length === 1 ? inputShape[0].unit : null,
      entryPolicy: line.contract?.entryPolicy ?? "none", entries: entries.filter(entry => entry.componentId === line.componentId) };
  });
}
