import { sql } from "drizzle-orm";
import { customerLocations, deliveries } from "@/db/schema";

interface DeliveryDistanceColumns {
  distanceKmOverride: boolean;
  distanceSource: boolean;
}

export function effectiveDeliveryDistanceSource(
  columns: DeliveryDistanceColumns,
) {
  if (!columns.distanceKmOverride || !columns.distanceSource) {
    return customerLocations.distanceSource;
  }

  return sql<"map_estimate" | "manual" | "document" | null>`case
    when ${deliveries.distanceSource} = 'document'
      then 'document'::distance_source
    when ${deliveries.distanceKmOverride} is not null
      then coalesce(${deliveries.distanceSource}, 'manual')
    else ${customerLocations.distanceSource}
  end`;
}

export function effectiveDeliveryDistanceKm(columns: DeliveryDistanceColumns) {
  return columns.distanceKmOverride
    ? sql<number | null>`coalesce(${deliveries.distanceKmOverride}, ${customerLocations.distanceFromFacilityKm})`
    : customerLocations.distanceFromFacilityKm;
}
