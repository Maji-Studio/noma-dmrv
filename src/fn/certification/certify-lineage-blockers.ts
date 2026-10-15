import type { BatchLineageRunFact } from "@/data-access/credit-batch-lineage-types";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { applicationDestinationBlocker, deliveryDistanceBlocker, type SubmissionLineageBlocker } from "@/lib/certification/submission-readiness";
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
): SubmissionLineageBlocker[] {
  const blockers: SubmissionLineageBlocker[] = [];
  for (const id of requiredTransportCategories.includes("feedstock") ? missingFeedstockIds : []) {
    const code = feedstockCodes[id];
    const label = code ? `Feedstock ${code}` : "A feedstock";
    blockers.push({
      detail: `${label} has no usable transport leg. Record a positive distance and load mass before submitting.`,
      fixTarget: "feedstocks",
      record: { id, code: code ?? "Feedstock" },
    });
  }
  for (const { application, delivery, order } of lineages) {
    const destination = applicationDestinationBlocker({
      applicationCode: application.code,
      // The lineage projection resolves this from the order destination.
      customerLocationId: delivery.customerLocationId ?? null,
    });
    if (destination) blockers.push({
      detail: destination,
      fixTarget: order ? "orders" : "deliveries",
      record: { id: (order ?? delivery).id, code: (order ?? delivery).code },
    });
    const distance = requiredTransportCategories.includes("biochar") ? deliveryDistanceBlocker({
      deliveryCode: delivery.code,
      deliveryStatus: delivery.status,
      distanceKmOverride: delivery.distanceKmOverride ?? null,
      locationDistanceKm: delivery.locationDistanceKm ?? null,
    }) : null;
    if (distance) blockers.push({ detail: distance, fixTarget: "deliveryDistances", record: { id: delivery.id, code: delivery.code } });
  }
  return [...new Map(blockers.map((blocker) => [
    `${blocker.fixTarget}:${blocker.record.id}:${blocker.detail}`, blocker,
  ])).values()];
}
