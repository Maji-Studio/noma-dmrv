import { describe, expect, it } from "vitest";
import type { Delivery } from "@/db/schema";
import { isDeliveryTruckMassCompletion } from "./delivery-mass-gated-correction";

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

  it("rejects changing another captured fact", () => {
    expect(
      isDeliveryTruckMassCompletion(delivery, {
        deliveredWetMassKg: 999,
        truckMassOnArrivalKg: 8_000,
        truckMassOnDepartureKg: 7_000,
      }),
    ).toBe(false);
  });

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
