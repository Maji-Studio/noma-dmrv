import { blockerMessage, type BlockerMessage } from "./blocker-message";
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

export function durabilityConfigurationBlockerDetails(
  batches: readonly { sampling: string; durabilityOption: string }[],
): BlockerMessage[] {
  const blockers: BlockerMessage[] = [];
  if (batches.some((batch) => batch.sampling !== "sampled")) {
    blockers.push(
      blockerMessage("Unsampled Method B Removals cannot be submitted yet.", "Wait for support to confirm registry availability."),
    );
  }
  if (batches.some((batch) => batch.durabilityOption !== "1000_year")) {
    blockers.push(
      blockerMessage("200-year Removals cannot be submitted yet.", "Wait for support to confirm registry availability."),
    );
  }
  const thousandYearCount = batches.filter(
    (batch) => batch.durabilityOption === "1000_year",
  ).length;
  if (thousandYearCount > MAX_1000_YEAR_CREDIT_BATCHES) {
    blockers.push(
      blockerMessage("A 1000-year Removal can contain one credit batch.", "Split these credit batches into separate Removals."),
    );
  }
  return blockers;
}

export function durabilityConfigurationBlockers(
  batches: readonly { sampling: string; durabilityOption: string }[],
): string[] {
  return durabilityConfigurationBlockerDetails(batches).map((item) => item.message);
}

export const feedstockTransportMessage = (label: string) => blockerMessage(
  `${label} has no usable transport leg.`,
  "Record a positive distance and load mass before submitting.",
);
export const applicationDestinationMessage = (code: string) => blockerMessage(
  `Application ${code} has no customer location.`,
  "Select a customer location on the order before submitting.",
);
export const deliveryProofMessage = (code: string) => blockerMessage(
  `Delivery ${code} has no proof of delivery.`,
  "Attach a delivery receipt, bill of lading or delivery photo before submitting.",
);
export const deliveryDistanceMessage = (code: string) => blockerMessage(
  `Delivery ${code} has no positive transport distance.`,
  "Set the customer location distance or a delivery distance override before submitting.",
);

export function applicationDestinationBlockerMessage(input: {
  applicationCode: string;
  customerLocationId: string | null;
}): BlockerMessage | null {
  return input.customerLocationId
    ? null
    : applicationDestinationMessage(input.applicationCode);
}

export function applicationDestinationBlocker(input: Parameters<typeof applicationDestinationBlockerMessage>[0]): string | null {
  return applicationDestinationBlockerMessage(input)?.message ?? null;
}

export function deliveryProofBlockerMessage(input: {
  deliveryCode: string;
  proofOfDeliveryCount: number;
}): BlockerMessage | null {
  return input.proofOfDeliveryCount > 0
    ? null
    : deliveryProofMessage(input.deliveryCode);
}

export function deliveryProofBlocker(input: Parameters<typeof deliveryProofBlockerMessage>[0]): string | null {
  return deliveryProofBlockerMessage(input)?.message ?? null;
}

export function deliveryDistanceBlockerMessage(input: {
  deliveryCode: string;
  deliveryStatus: string | null;
  distanceKmOverride: number | null;
  recordedDistanceKm: number | null;
}): BlockerMessage | null {
  return input.deliveryStatus === "delivered" &&
    positiveOrNull(input.distanceKmOverride) == null &&
    positiveOrNull(input.recordedDistanceKm) == null
    ? deliveryDistanceMessage(input.deliveryCode)
    : null;
}

export function deliveryDistanceBlocker(input: Parameters<typeof deliveryDistanceBlockerMessage>[0]): string | null {
  return deliveryDistanceBlockerMessage(input)?.message ?? null;
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
  fact: string;
  detail: string;
  fixTarget: "feedstocks" | "deliveryEvidence" | "deliveryDistances" | "orders" | "deliveries";
  record: { id: string; code: string; href?: string };
}
