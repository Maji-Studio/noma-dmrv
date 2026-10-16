import { emissionDeliveryShares } from "@/lib/certification/emission-delivery-shares";
import { requireOrgFacility } from "@/data-access/utils";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { batchAutomaticFigures } from "@/lib/certification/batch-automatic-figures";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

export async function loadBatchAutomaticFigures(ctx: OrgContext, facilityId: string, creditBatchId: string, options: { requireDeliveryMass?: boolean } = {}) {
  requireOrgScope(ctx);
  await requireOrgFacility(ctx, facilityId);
  const batch = await getCreditBatchById(ctx, creditBatchId, { skipPreview: true });
  if (!batch || batch.facilityId !== facilityId) throw new SafeError("Credit batch was not found.");
  const [rollups, runs, samples] = await Promise.all([
    loadCreditBatchRollups(ctx, [creditBatchId], { includeRunForwards: true }),
    getProductionRunsForCertification(ctx, batch.productionRunIds),
    getSamplesByCreditBatchIds(ctx, [creditBatchId]),
  ]);
  const lineage = rollups[creditBatchId]?.lineageFacts;
  if (!lineage) throw new SafeError("Credit batch accounting could not be loaded");
  const feedstockIds = [
    ...new Set(lineage.runs.flatMap((run) => run.feedstocks.map((feedstock) => feedstock.id))),
  ];
  // Run-forward slices include shipments not yet applied, and only this batch's share.
  const deliveries = emissionDeliveryShares(lineage.runForwards);
  const missingLoadMass = deliveries.find((delivery) => delivery.exactWetMassKg == null);
  if (missingLoadMass && options.requireDeliveryMass)
    throw new SafeError(`Delivery ${missingLoadMass.code} has no load mass. Add it before submitting.`);
  const [feedstock, biochar, sample] = await Promise.all([
    getTransportLegsForEntities(ctx, "feedstock", feedstockIds),
    loadBiocharDeliveryTransportLegs(
      ctx,
      deliveries.filter((delivery) => delivery.exactWetMassKg != null).map((delivery) => ({
        deliveryId: delivery.id,
        loadMassKg: Number(delivery.exactWetMassKg!),
      })),
    ),
    getTransportLegsForEntities(
      ctx,
      "sample",
      samples.map((sample) => sample.id),
    ),
  ]);
  const exactMasses = await getEmissionAutomaticMasses(
    ctx,
    runs.map((run) => run.id),
    [...feedstock, ...sample].map((leg) => leg.id),
  );
  // The transport projection accepts numbers; use the retained decimal shares for totals.
  for (const delivery of deliveries) exactMasses.legs[delivery.id] = delivery.exactWetMassKg;
  const figures = batchAutomaticFigures(runs, { feedstock, biochar, sample }, exactMasses);
  // An incomplete delivery figure is unknown, never a partial total. Health and
  // unrelated operator-zero writes must still be able to read the other lines.
  if (missingLoadMass) figures["delivery-transport"] = null;
  return figures;
}
