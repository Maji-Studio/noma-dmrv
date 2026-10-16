import type { FacilityDistanceInput } from "@/schemas/facility-distances";

/** Omitted pairs stay unchanged; null only clears a previously saved distance. */
export function facilityDistanceChanges(
  current: readonly FacilityDistanceInput[] = [],
  saved: readonly FacilityDistanceInput[] = [],
): FacilityDistanceInput[] {
  return current.filter(row => {
    const previous = saved.find(pair => pair.facilityId === row.facilityId);
    if (row.distanceKm === null) return previous?.distanceKm != null;
    return row.distanceKm !== previous?.distanceKm || row.distanceSource !== previous?.distanceSource;
  });
}
