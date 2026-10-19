import type { Delivery } from "@/db/schema";

// All persisted fields other than the fill's distance, provenance, version and timestamp.
const UNCHANGED_FIELDS = [
  "id", "organizationId", "code", "facilityId", "orderId", "deliveryDate",
  "status", "distanceKmOverride", "distanceSource", "distanceNote",
  "storageLocationId", "biocharStorageInventoryId", "moistureContentPercent",
  "deliveredWetMassKg", "massDryKg", "driverId", "vehicleId", "archivedAt", "createdAt",
] as const satisfies readonly (keyof Delivery)[];

/** Accept exactly one fill-only write, never silently advance past another edit. */
export function deliveryAfterDistanceFill(opened: Delivery, refreshed?: Delivery): Delivery {
  if (!refreshed || opened.recordedDistanceKm != null || refreshed.recordedDistanceKm == null ||
      refreshed.version !== opened.version + 1 ||
      !UNCHANGED_FIELDS.every(key => JSON.stringify(opened[key]) === JSON.stringify(refreshed[key]))) {
    return opened;
  }
  return { ...opened, recordedDistanceKm: refreshed.recordedDistanceKm,
    recordedDistanceSource: refreshed.recordedDistanceSource, version: refreshed.version,
    updatedAt: refreshed.updatedAt };
}
