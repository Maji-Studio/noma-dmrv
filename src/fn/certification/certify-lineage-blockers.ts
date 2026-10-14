import type { BatchLineageRunFact } from "@/data-access/credit-batch-lineage-types";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { applicationDestinationBlocker, deliveryDistanceBlocker } from "@/lib/certification/submission-readiness";
import type { TransportCategory } from "./certify-transport-coverage";

export function collectFeedstockCodes(runs: readonly BatchLineageRunFact[]): Record<string, string> {
  return Object.fromEntries(runs.flatMap((run) =>
    run.feedstocks.map((feedstock) => [feedstock.id, feedstock.code]),
  ));
}

export function buildSubmissionLineageBlockers(
  lineages: readonly ChainOfCustodyData[],
  missingFeedstockIds: readonly string[],
  feedstockCodes: Readonly<Record<string, string>>,
  requiredTransportCategories: readonly TransportCategory[],
): string[] {
  return [...new Set([
    ...(requiredTransportCategories.includes("feedstock") ? missingFeedstockIds : []).map((id) => {
      const label = feedstockCodes[id] ? `Feedstock ${feedstockCodes[id]}` : "A feedstock";
      return `${label} has no usable transport leg. Record a positive distance and load mass before submitting.`;
    }),
    ...lineages.flatMap(({ application, delivery }) => [
      applicationDestinationBlocker({
        applicationCode: application.code,
        customerLocationId: delivery.customerLocationId ?? null,
      }),
      requiredTransportCategories.includes("biochar") ? deliveryDistanceBlocker({
        deliveryCode: delivery.code,
        deliveryStatus: delivery.status,
        distanceKmOverride: delivery.distanceKmOverride ?? null,
        locationDistanceKm: delivery.locationDistanceKm ?? null,
      }) : null,
    ]).filter((reason): reason is string => reason != null),
  ])];
}
