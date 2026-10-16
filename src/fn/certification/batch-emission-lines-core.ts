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

// A PR 3 action wrapping this trusted-context read must also check the facility.
/** Batch display facts only. A stored observation never authorizes submission. */
export async function loadBatchEmissionLines(ctx: OrgContext, creditBatchId: string) {
  const batch = await getCreditBatchById(ctx, creditBatchId, { skipPreview: true });
  if (!batch) throw new SafeError("Credit batch was not found.");
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
  const deliveries = Object.values(lineage.runForwards ?? {}).flatMap((products) => products.flatMap((product) => product.deliveries));
  const missingLoadMass = deliveries.find((delivery) => delivery.wetMassKg == null);
  if (missingLoadMass) throw new SafeError(`Delivery ${missingLoadMass.code} has no load mass. Add it before submitting.`);
  const [feedstock, biochar, sample] = await Promise.all([
    getTransportLegsForEntities(ctx, "feedstock", feedstockIds),
    loadBiocharDeliveryTransportLegs(ctx, deliveries.map((delivery) => ({ deliveryId: delivery.id, loadMassKg: delivery.wetMassKg! }))),
    getTransportLegsForEntities(ctx, "sample", samples.map((sample) => sample.id)),
  ]);
  return deriveBatchEmissionLines({ definition: observation.definition, lineSources: observation.lineSources,
    problems: validateLineSources(observation.definition, observation.lineSources),
    enrichmentComplete: isEnrichmentComplete(observation.definition, observation.enrichment),
    automaticFigures: batchAutomaticFigures(runs, { feedstock, biochar, sample }), entries: [],
  });
}
