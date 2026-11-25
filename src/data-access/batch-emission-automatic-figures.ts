import { linkedFeedstockIdsOwnedElsewhere, ownedTransportFeedstockIds } from "@/lib/certification/feedstock-transport-ownership";
import { db, type DbTransaction } from "@/db";
import { emissionDeliveryShares } from "@/lib/certification/emission-delivery-shares";
import { requireOrgScope } from "@/data-access/utils";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { batchAutomaticFigures } from "@/lib/certification/batch-automatic-figures";
import type { BatchEmissionLineFacts } from "@/lib/certification/emission-lines";
import type { OrgContext } from "@/lib/auth/server";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { loadBatchEmissionContributors } from "./credit-batch-emission-contributors";
import { getFeedstockTransportOwners } from "./feedstock-transport-ownership";
import { getFeedstockTransportOwnerBatches } from "@/data-access/feedstock-transport-ownership";
import { SafeError } from "@/lib/errors";

type AutomaticFacts = Pick<BatchEmissionLineFacts, "automaticFigures" | "automaticRecordCounts" | "feedstockTransportCountedOn">;
type AutomaticOptions = { requireDeliveryMass?: boolean };
const unique = (ids: string[]) => [...new Set(ids)];

/** Set-based reads for all batches, including shipments not yet applied. */
export async function loadBatchesEmissionAutomaticFacts(
  ctx: OrgContext, creditBatchIds: string[], options: AutomaticOptions = {}, executor: DbTransaction | typeof db = db,
): Promise<Record<string, AutomaticFacts>> {
  requireOrgScope(ctx);
  const ids = unique(creditBatchIds);
  if (!ids.length) return {};
  const rollups = await loadCreditBatchRollups(ctx, ids, { includeRunForwards: true }, executor);
  const contributors = await loadBatchEmissionContributors(ctx, ids, executor);
  const allContributors = Object.values(contributors).flatMap(batch => [...batch.materialMembers, ...batch.failedContributors]);
  const owners = await getFeedstockTransportOwners(ctx, unique(allContributors.flatMap(run => run.feedstockIds)), executor);
  const batches = ids.map((id) => {
    const lineage = rollups[id]?.lineageFacts;
    if (!lineage) throw new SafeError("Credit batch accounting could not be loaded");
    const deliveries = emissionDeliveryShares(lineage.runForwards);
    const missing = deliveries.find((delivery) => delivery.exactWetMassKg == null);
    if (missing && options.requireDeliveryMass)
      throw new SafeError(`Delivery ${missing.code} has no load mass. Add it before submitting.`);
    const emissionRuns = [...(contributors[id]?.materialMembers ?? []), ...(contributors[id]?.failedContributors ?? [])]
      .map(run => ({ id: run.runId, feedstocks: run.feedstockIds.map(feedstockId => ({ id: feedstockId, ownsTransport: owners.get(feedstockId) === run.runId })) }));
    return { id, lineage, deliveries, missing, emissionRuns };
  });
  const runIds = unique(batches.flatMap(({ emissionRuns }) => emissionRuns.map((run) => run.id)));
  const feedstockIds = unique(batches.flatMap(({ emissionRuns }) =>
    ownedTransportFeedstockIds(emissionRuns),
  ));
  const deliveryById = new Map(batches.flatMap(({ deliveries }) =>
    deliveries.filter((delivery) => delivery.exactWetMassKg != null).map((delivery) => [delivery.id, delivery] as const),
  ));
  const [runs, feedstock, biochar] = await Promise.all([
    getProductionRunsForCertification(ctx, runIds, executor),
    getTransportLegsForEntities(ctx, "feedstock", feedstockIds, executor),
    loadBiocharDeliveryTransportLegs(ctx, [...deliveryById.values()].map((delivery) => ({
      deliveryId: delivery.id, loadMassKg: Number(delivery.exactWetMassKg!),
    })), executor),
  ]);
  const linkedFeedstockIds = unique(batches.flatMap(({ emissionRuns }) => linkedFeedstockIdsOwnedElsewhere(emissionRuns)));
  const ownerBatches = await getFeedstockTransportOwnerBatches(ctx, linkedFeedstockIds, executor);
  const exact = await getEmissionAutomaticMasses(ctx, runIds, feedstock.map((leg) => leg.id), executor);
  return Object.fromEntries(batches.map(({ id, lineage, deliveries, missing, emissionRuns }) => {
    const memberRuns = new Set(lineage.runs.map((run) => run.id));
    const memberFeedstocks = new Set(ownedTransportFeedstockIds(emissionRuns));
    const memberDeliveries = new Set(deliveries.map((delivery) => delivery.id));
    const batchRuns = runs.filter((run) => memberRuns.has(run.id));
    const legs = {
      feedstockTransportOwnedElsewhere: linkedFeedstockIdsOwnedElsewhere(emissionRuns).length > 0,
      feedstock: feedstock.filter((leg) => memberFeedstocks.has(leg.entityId)),
      biochar: biochar.filter((leg) => memberDeliveries.has(leg.id)),
      sample: [],
    };
    // A delivery can contain several batches. Retain each batch's exact load share.
    const masses = { runs: exact.runs, legs: { ...exact.legs } };
    for (const delivery of deliveries) masses.legs[delivery.id] = delivery.exactWetMassKg;
    const countedOn = legs.feedstockTransportOwnedElsewhere
      ? [...new Map(emissionRuns.flatMap((run) => run.feedstocks.flatMap((f) => ownerBatches.get(f.id) ?? []))
        .filter((owner) => owner.creditBatchId !== id).map((owner) => [owner.creditBatchId, owner] as const)).values()]
        .sort((a, b) => a.code.localeCompare(b.code))
      : [];
    const automaticFigures = batchAutomaticFigures(batchRuns, legs, masses, runs.filter(run => contributors[id]?.failedContributors.some(contributor => contributor.runId === run.id)));
    // Unknown load mass makes the whole delivery figure unknown, never a partial sum.
    if (missing) automaticFigures["delivery-transport"] = null;
    const count = emissionRuns.length;
    const applicationCount = new Set(lineage.applications?.map((application) => application.id) ?? []).size;
    return [id, {
      automaticFigures,
      ...(countedOn.length ? { feedstockTransportCountedOn: countedOn } : {}),
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
