import type { Facility } from "@/db/schema";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";

/** Keep saved pairs and initialize every visible input before the form mounts. */
export function facilityDistanceDefaults(
  facilities: readonly Facility[],
  saved: readonly FacilityDistanceInput[] = [],
): FacilityDistanceInput[] {
  return [
    ...saved.map(row => ({ ...row, distanceKm: row.distanceKm ?? null })),
    ...facilities.filter(facility => !facility.archivedAt && !saved.some(row => row.facilityId === facility.id))
      .map(facility => ({ facilityId: facility.id, distanceKm: null, distanceSource: "manual" as const })),
  ];
}
