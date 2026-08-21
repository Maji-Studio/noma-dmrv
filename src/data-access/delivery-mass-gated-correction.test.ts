import { describe, expect, it } from "vitest";
import type { Delivery } from "@/db/schema";
import {
  isDeliveryTruckMassCompletion,
  type DeliveryUpdateData,
} from "./delivery-mass-gated-correction";

const delivery = {
  code: "DL-001",
  orderId: "order-1",
  facilityId: "facility-1",
  deliveryDate: new Date("2026-08-21T00:00:00Z"),
  biocharProductId: "product-1",
  driverId: null,
  vehicleId: null,
  status: "delivered",
  deliveredWetMassKg: 1_000,
  truckMassOnArrivalKg: null,
  truckMassOnDepartureKg: null,
  moistureContentPercent: 10,
  distanceKmOverride: null,
  distanceSource: "document",
  distanceNote: null,
  tripType: "one_way",
} as Delivery;

type NonMassDeliveryUpdateKey = Exclude<
  keyof DeliveryUpdateData,
  "truckMassOnArrivalKg" | "truckMassOnDepartureKg"
>;

const NON_MASS_FIELD_CHANGES = {
  code: { code: "DL-002" },
  orderId: { orderId: "order-2" },
  facilityId: { facilityId: "facility-2" },
  deliveryDate: { deliveryDate: new Date("2026-08-22T00:00:00Z") },
  biocharProductId: { biocharProductId: "product-2" },
  driverId: { driverId: "driver-1" },
  vehicleId: { vehicleId: "vehicle-1" },
  status: { status: "upcoming" },
  deliveredWetMassKg: { deliveredWetMassKg: 999 },
  moistureContentPercent: { moistureContentPercent: 11 },
  distanceKmOverride: { distanceKmOverride: 1 },
  distanceSource: { distanceSource: "manual" },
  distanceNote: { distanceNote: "Changed" },
  tripType: { tripType: "return" },
} satisfies Record<NonMassDeliveryUpdateKey, DeliveryUpdateData>;

describe("isDeliveryTruckMassCompletion", () => {
  it("accepts completing the missing pair with otherwise unchanged form data", () => {
    expect(
      isDeliveryTruckMassCompletion(delivery, {
        code: delivery.code,
        orderId: delivery.orderId,
        facilityId: delivery.facilityId,
        deliveryDate: new Date(delivery.deliveryDate),
        status: "delivered",
        deliveredWetMassKg: delivery.deliveredWetMassKg,
        truckMassOnArrivalKg: 8_000,
        truckMassOnDepartureKg: 7_000,
      }),
    ).toBe(true);
  });

  it.each(Object.entries(NON_MASS_FIELD_CHANGES))(
    "rejects changing non-mass field %s",
    (_field, change) => {
      expect(
        isDeliveryTruckMassCompletion(delivery, {
          ...change,
          truckMassOnArrivalKg: 8_000,
          truckMassOnDepartureKg: 7_000,
        }),
      ).toBe(false);
    },
  );

  it("rejects overwriting an observed mass", () => {
    expect(
      isDeliveryTruckMassCompletion(
        { ...delivery, truckMassOnArrivalKg: 8_000 },
        {
          truckMassOnArrivalKg: 8_100,
          truckMassOnDepartureKg: 7_000,
        },
      ),
    ).toBe(false);
  });
});
