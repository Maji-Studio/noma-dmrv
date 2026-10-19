import { emissionDeliveryShares } from "@/lib/certification/emission-delivery-shares";
import { requireOrgFacility, requireOrgScope } from "@/data-access/utils";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { batchAutomaticFigures } from "@/lib/certification/batch-automatic-figures";
import type { BatchEmissionLineFacts } from "@/lib/certification/emission-lines";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { SafeError } from "@/lib/errors";

type AutomaticFacts = Pick<BatchEmissionLineFacts, "automaticFigures" | "automaticRecordCounts">;
type AutomaticOptions = { requireDeliveryMass?: boolean };
const unique = (ids: string[]) => [...new Set(ids)];

/** Set-based reads for all batches, including shipments not yet applied. */
export async function loadBatchesEmissionAutomaticFacts(
  ctx: OrgContext, creditBatchIds: string[], options: AutomaticOptions = {},
): Promise<Record<string, AutomaticFacts>> {
  requireOrgScope(ctx);
  const ids = unique(creditBatchIds);
  if (!ids.length) return {};
  const [rollups, samples] = await Promise.all([
    loadCreditBatchRollups(ctx, ids, { includeRunForwards: true }),
    getSamplesByCreditBatchIds(ctx, ids),
  ]);
  const batches = ids.map((id) => {
    const lineage = rollups[id]?.lineageFacts;
    if (!lineage) throw new SafeError("Credit batch accounting could not be loaded");
    const deliveries = emissionDeliveryShares(lineage.runForwards);
    const missing = deliveries.find((delivery) => delivery.exactWetMassKg == null);
    if (missing && options.requireDeliveryMass)
      throw new SafeError(`Delivery ${missing.code} has no load mass. Add it before submitting.`);
    return { id, lineage, deliveries, missing };
  });
  const runIds = unique(batches.flatMap(({ lineage }) => lineage.runs.map((run) => run.id)));
  const feedstockIds = unique(batches.flatMap(({ lineage }) =>
    lineage.runs.flatMap((run) => run.feedstocks.map((feedstock) => feedstock.id)),
  ));
  const deliveryById = new Map(batches.flatMap(({ deliveries }) =>
    deliveries.filter((delivery) => delivery.exactWetMassKg != null).map((delivery) => [delivery.id, delivery] as const),
  ));
  const [runs, feedstock, biochar, sample] = await Promise.all([
    getProductionRunsForCertification(ctx, runIds),
    getTransportLegsForEntities(ctx, "feedstock", feedstockIds),
    loadBiocharDeliveryTransportLegs(ctx, [...deliveryById.values()].map((delivery) => ({
      deliveryId: delivery.id, loadMassKg: Number(delivery.exactWetMassKg!),
    }))),
    getTransportLegsForEntities(ctx, "sample", samples.map((sample) => sample.id)),
  ]);
  const exact = await getEmissionAutomaticMasses(ctx, runIds, [...feedstock, ...sample].map((leg) => leg.id));
  return Object.fromEntries(batches.map(({ id, lineage, deliveries, missing }) => {
    const memberRuns = new Set(lineage.runs.map((run) => run.id));
    const memberFeedstocks = new Set(lineage.runs.flatMap((run) => run.feedstocks.map((feedstock) => feedstock.id)));
    const memberDeliveries = new Set(deliveries.map((delivery) => delivery.id));
    const memberSamples = new Set(samples.filter((sample) => sample.creditBatchId === id).map((sample) => sample.id));
    const batchRuns = runs.filter((run) => memberRuns.has(run.id));
    const legs = {
      feedstock: feedstock.filter((leg) => memberFeedstocks.has(leg.entityId)),
      biochar: biochar.filter((leg) => memberDeliveries.has(leg.id)),
      sample: sample.filter((leg) => memberSamples.has(leg.entityId)),
    };
    // A delivery can contain several batches. Retain each batch's exact load share.
    const masses = { runs: exact.runs, legs: { ...exact.legs } };
    for (const delivery of deliveries) masses.legs[delivery.id] = delivery.exactWetMassKg;
    const automaticFigures = batchAutomaticFigures(batchRuns, legs, masses);
    // Unknown load mass makes the whole delivery figure unknown, never a partial sum.
    if (missing) automaticFigures["delivery-transport"] = null;
    const count = memberRuns.size;
    const applicationCount = new Set(lineage.applications?.map((application) => application.id) ?? []).size;
    return [id, {
      automaticFigures,
      automaticRecordCounts: {
        "run-electricity": count, "run-genset-diesel": count, "run-startup-diesel": count,
        "feedstock-dry-mass": count, "biochar-dry-mass": memberDeliveries.size, "safety-margin": applicationCount,
        "feedstock-transport": legs.feedstock.length, "sample-transport": legs.sample.length,
        "delivery-transport": memberDeliveries.size,
        sequestration: applicationCount,
      },
    }];
  }));
}

export async function loadBatchEmissionAutomaticFacts(
  ctx: OrgContext, facilityId: string, creditBatchId: string, options: AutomaticOptions = {},
) {
  requireOrgScope(ctx);
  await requireOrgFacility(ctx, facilityId);
  const batch = await getCreditBatchById(ctx, creditBatchId, { skipPreview: true });
  if (!batch || batch.facilityId !== facilityId) throw new SafeError("Credit batch was not found.");
  return (await loadBatchesEmissionAutomaticFacts(ctx, [creditBatchId], options))[creditBatchId];
}

export async function loadBatchAutomaticFigures(
  ctx: OrgContext, facilityId: string, creditBatchId: string, options: AutomaticOptions = {},
) {
  requireOrgScope(ctx);
  return (await loadBatchEmissionAutomaticFacts(ctx, facilityId, creditBatchId, options)).automaticFigures;
}
