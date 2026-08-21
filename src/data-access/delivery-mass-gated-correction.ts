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

type TruckMassUpdateKey =
  | "truckMassOnArrivalKg"
  | "truckMassOnDepartureKg";
type NonMassDeliveryUpdateKey = Exclude<
  keyof DeliveryUpdateData,
  TruckMassUpdateKey
>;
type NonMassFieldComparator = (
  update: DeliveryUpdateData,
  current: Delivery,
) => boolean;

const NON_MASS_FIELD_COMPARATORS = {
  code: (update, current) => unchanged(update.code, current.code),
  orderId: (update, current) => unchanged(update.orderId, current.orderId),
  facilityId: (update, current) =>
    unchanged(update.facilityId, current.facilityId),
  deliveryDate: (update, current) =>
    update.deliveryDate === undefined ||
    update.deliveryDate.getTime() === current.deliveryDate.getTime(),
  biocharProductId: (update, current) =>
    unchanged(update.biocharProductId, current.biocharProductId),
  driverId: (update, current) => unchanged(update.driverId, current.driverId),
  vehicleId: (update, current) =>
    unchanged(update.vehicleId, current.vehicleId),
  status: (update, current) => unchanged(update.status, current.status),
  deliveredWetMassKg: (update, current) =>
    unchanged(update.deliveredWetMassKg, current.deliveredWetMassKg),
  moistureContentPercent: (update, current) =>
    unchanged(update.moistureContentPercent, current.moistureContentPercent),
  distanceKmOverride: (update, current) =>
    unchanged(update.distanceKmOverride, current.distanceKmOverride),
  distanceSource: (update, current) =>
    unchanged(update.distanceSource, current.distanceSource),
  distanceNote: (update, current) =>
    unchanged(update.distanceNote, current.distanceNote),
  tripType: (update, current) =>
    update.tripType == null || update.tripType === current.tripType,
} satisfies Record<NonMassDeliveryUpdateKey, NonMassFieldComparator>;

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

  return Object.values(NON_MASS_FIELD_COMPARATORS).every((comparator) =>
    comparator(update, current),
  );
}
