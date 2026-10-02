import { distanceSources, type DistanceSourceValue } from "@/schemas/distance-source";

/** What picking an option in the delivery's Distance source select does. */
export type DeliveryDistanceSourceChoice =
  /** Back to the customer location's route calculation: drop override, source and note. */
  | { kind: "inherit-stored" }
  /** Store this source on the delivery; null keeps the stored one inherited. */
  | { kind: "set"; source: DistanceSourceValue | null };

function isDistanceSource(value: string): value is DistanceSourceValue {
  return (distanceSources as readonly string[]).includes(value);
}

/**
 * Resolve a raw select value. The placeholder option ("") and anything else
 * outside the enum never reach the form value: they mean "no source of this
 * delivery's own", which is null, never an empty string the schema rejects.
 */
export function resolveDeliveryDistanceSourceChoice(
  raw: string,
  context: {
    storedDistanceKm: number | null;
    storedDistanceSource: DistanceSourceValue | null;
    hasOverride: boolean;
  },
): DeliveryDistanceSourceChoice {
  if (!isDistanceSource(raw)) return { kind: "set", source: null };
  if (
    raw === "map_estimate" &&
    context.storedDistanceSource === "map_estimate" &&
    context.storedDistanceKm != null
  ) {
    return { kind: "inherit-stored" };
  }
  // A matching manual customer-location value stays inherited; only an
  // edited distance becomes a delivery-specific manual override.
  if (raw === "manual" && !context.hasOverride) return { kind: "set", source: null };
  return { kind: "set", source: raw };
}
