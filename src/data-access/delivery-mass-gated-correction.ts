import type { Delivery } from "@/db/schema";

export interface DeliveryUpdateData {
  code?: string;
  orderId?: string;
  facilityId?: string;
  deliveryDate?: Date;
  biocharProductId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  status?: "upcoming" | "delivered";
  deliveredWetMassKg?: number | null;
  truckMassOnArrivalKg?: number | null;
  truckMassOnDepartureKg?: number | null;
  moistureContentPercent?: number | null;
  distanceKmOverride?: number | null;
  distanceSource?: "map_estimate" | "manual" | "document" | null;
  distanceNote?: string | null;
  tripType?: "return" | "one_way" | null;
}

function unchanged<T>(next: T | undefined, current: T): boolean {
  return next === undefined || next === current;
}

/**
 * Identifies the one correction allowed through a certified delivery lock:
 * completing missing truck observations without changing any captured fact.
 */
export function isDeliveryTruckMassCompletion(
  current: Delivery,
  update: DeliveryUpdateData,
): boolean {
  const arrival = update.truckMassOnArrivalKg;
  const departure = update.truckMassOnDepartureKg;
  if (arrival == null || departure == null) return false;
  if (
    current.truckMassOnArrivalKg != null &&
    current.truckMassOnArrivalKg !== arrival
  ) {
    return false;
  }
  if (
    current.truckMassOnDepartureKg != null &&
    current.truckMassOnDepartureKg !== departure
  ) {
    return false;
  }
  if (
    current.truckMassOnArrivalKg != null &&
    current.truckMassOnDepartureKg != null
  ) {
    return false;
  }

  return (
    unchanged(update.code, current.code) &&
    unchanged(update.orderId, current.orderId) &&
    unchanged(update.facilityId, current.facilityId) &&
    (update.deliveryDate === undefined ||
      update.deliveryDate.getTime() === current.deliveryDate.getTime()) &&
    unchanged(update.biocharProductId, current.biocharProductId) &&
    unchanged(update.driverId, current.driverId) &&
    unchanged(update.vehicleId, current.vehicleId) &&
    unchanged(update.status, current.status as "upcoming" | "delivered") &&
    unchanged(update.deliveredWetMassKg, current.deliveredWetMassKg) &&
    unchanged(update.moistureContentPercent, current.moistureContentPercent) &&
    unchanged(update.distanceKmOverride, current.distanceKmOverride) &&
    unchanged(update.distanceSource, current.distanceSource) &&
    unchanged(update.distanceNote, current.distanceNote) &&
    (update.tripType == null || update.tripType === current.tripType)
  );
}
