import { blockerMessage } from "@/lib/certification/blocker-message";
import type { BatchLineageRunFact } from "@/data-access/credit-batch-lineage-types";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { applicationDestinationCopy, deliveryDistanceCopy, deliveryProofCopy, applicationDestinationBlocker, deliveryDistanceBlocker, deliveryProofBlocker, type SubmissionLineageBlocker } from "@/lib/certification/submission-readiness";
import type { TransportCategory } from "./certify-transport-coverage";

export function feedstockTransportCopy(label: string) {
  return blockerMessage(`${label} has no usable transport leg.`, "Record a positive distance and load mass before submitting.");
}

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
    const copy = feedstockTransportCopy(label);
    blockers.push({
      detail: copy.message,
      fact: copy.fact,
      fixTarget: "feedstocks",
      record: { id, code: code ?? "Feedstock" },
    });
  }
  for (const { application, delivery, order } of lineages) {
    const proof = deliveryProofBlocker({
      deliveryCode: delivery.code,
      proofOfDeliveryCount: delivery.proofOfDeliveryCount,
    });
    if (proof) blockers.push({ detail: proof, fact: deliveryProofCopy(delivery.code).fact, fixTarget: "deliveryEvidence", record: { id: delivery.id, code: delivery.code } });
    const destination = applicationDestinationBlocker({
      applicationCode: application.code,
      // The lineage projection resolves this from the order destination.
      customerLocationId: delivery.customerLocationId ?? null,
    });
    if (destination) blockers.push({
      detail: destination,
      fact: applicationDestinationCopy(application.code).fact,
      fixTarget: order ? "orders" : "deliveries",
      record: { id: (order ?? delivery).id, code: (order ?? delivery).code },
    });
    const distance = requiredTransportCategories.includes("biochar") ? deliveryDistanceBlocker({
      deliveryCode: delivery.code,
      deliveryStatus: delivery.status,
      distanceKmOverride: delivery.distanceKmOverride ?? null,
      recordedDistanceKm: delivery.recordedDistanceKm ?? null,
    }) : null;
    if (distance) blockers.push({ detail: distance, fact: deliveryDistanceCopy(delivery.code).fact, fixTarget: "deliveryDistances", record: { id: delivery.id, code: delivery.code } });
  }
  return [...new Map(blockers.map((blocker) => [
    `${blocker.fixTarget}:${blocker.record.id}:${blocker.detail}`, blocker,
  ])).values()];
}
