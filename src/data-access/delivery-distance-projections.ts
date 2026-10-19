import type { Delivery } from "@/db/schema";
import { resolveDeliveryTransportRoute } from "@/lib/calculations/transport-leg";

/** Reads resolve the optional override over the frozen pair snapshot. */
export function effectiveDeliveryDistance(
  delivery: Pick<Delivery, "distanceKmOverride" | "distanceSource" | "recordedDistanceKm" | "recordedDistanceSource">,
) {
  const route = resolveDeliveryTransportRoute({ ...delivery, location: {
    distanceKm: delivery.recordedDistanceKm, distanceSource: delivery.recordedDistanceSource,
  } });
  return { effectiveDistanceKm: route.distanceKm, effectiveDistanceSource: route.distanceSource };
}
