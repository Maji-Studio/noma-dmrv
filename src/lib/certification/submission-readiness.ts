import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { isSequestrationBlueprintKey } from "@/lib/isometric/storage-blueprints";
import { positiveOrNull } from "@/lib/calculations/transport-leg";

const MAX_1000_YEAR_CREDIT_BATCHES = 1;

export function hasDurabilityMeasurementComponents(
  template: IsometricGhgEntryTemplate | null,
): boolean {
  return template?.groups.some((group) =>
    group.components.some((component) =>
      isSequestrationBlueprintKey(component.blueprint_key),
    ),
  ) ?? false;
}

export function durabilityConfigurationBlockers(
  batches: readonly { sampling: string; durabilityOption: string }[],
): string[] {
  const blockers: string[] = [];
  if (batches.some((batch) => batch.sampling !== "sampled")) {
    blockers.push(
      "Unsampled Method B Removals cannot be submitted yet. Wait for support to confirm registry availability.",
    );
  }
  if (batches.some((batch) => batch.durabilityOption !== "1000_year")) {
    blockers.push(
      "200-year Removals cannot be submitted yet. Wait for support to confirm registry availability.",
    );
  }
  const thousandYearCount = batches.filter(
    (batch) => batch.durabilityOption === "1000_year",
  ).length;
  if (thousandYearCount > MAX_1000_YEAR_CREDIT_BATCHES) {
    blockers.push(
      "A 1000-year Removal can contain one credit batch. Split these credit batches into separate Removals.",
    );
  }
  return blockers;
}

export function applicationDestinationBlocker(input: {
  applicationCode: string;
  customerLocationId: string | null;
}): string | null {
  return input.customerLocationId
    ? null
    : `Application ${input.applicationCode} has no customer location. Select a customer location on the order before submitting.`;
}

export function deliveryProofBlocker(input: {
  deliveryCode: string;
  proofOfDeliveryCount: number;
}): string | null {
  return input.proofOfDeliveryCount > 0
    ? null
    : `Delivery ${input.deliveryCode} has no proof of delivery. Attach a delivery receipt, bill of lading or delivery photo before submitting.`;
}

export function deliveryDistanceBlocker(input: {
  deliveryCode: string;
  deliveryStatus: string | null;
  distanceKmOverride: number | null;
  locationDistanceKm: number | null;
}): string | null {
  return input.deliveryStatus === "delivered" &&
    positiveOrNull(input.distanceKmOverride) == null &&
    positiveOrNull(input.locationDistanceKm) == null
    ? `Delivery ${input.deliveryCode} has no positive transport distance. Set the customer location distance or a delivery distance override before submitting.`
    : null;
}

export function missingFeedstockTransportIds(
  feedstockIds: readonly string[],
  legs: readonly {
    entityId: string;
    distanceKm: number | null;
    loadMassKg: number | null;
  }[],
): string[] {
  const covered = new Set(
    legs.filter((leg) =>
      positiveOrNull(leg.distanceKm) != null &&
      positiveOrNull(leg.loadMassKg) != null,
    ).map((leg) => leg.entityId),
  );
  return [...new Set(feedstockIds)].filter((id) => !covered.has(id));
}

export interface SubmissionLineageBlocker {
  detail: string;
  fixTarget: "feedstocks" | "deliveryEvidence" | "deliveryDistances" | "orders" | "deliveries";
  record: { id: string; code: string };
}
