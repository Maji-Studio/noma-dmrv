import { describe, expect, it } from "vitest";
import {
  createDeliverySchema,
  updateDeliverySchema,
} from "@/schemas/deliveries";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";

describe("delivery moisture precision", () => {
  it.each([-1, 101])(
    "rejects out-of-range moisture at the create boundary (%s)",
    (moistureContentPercent) => {
      const result = createDeliverySchema.safeParse({
        code: "DEL-001",
        orderId: UUID_A,
        facilityId: UUID_B,
        deliveryDate: new Date("2026-07-26T00:00:00Z"),
        moistureContentPercent,
      });

      expect(result.success).toBe(false);
    },
  );

  it.each([-1, 101])(
    "rejects out-of-range moisture at the update boundary (%s)",
    (moistureContentPercent) => {
      const result = updateDeliverySchema.safeParse({
        deliveryId: UUID_A,
        moistureContentPercent,
      });

      expect(result.success).toBe(false);
    },
  );
});

describe("delivery wet mass", () => {
  const createBase = {
    code: "DEL-001",
    orderId: UUID_A,
    facilityId: UUID_B,
    deliveryDate: new Date("2026-07-26T00:00:00Z"),
    moistureContentPercent: 20,
  };

  it("rejects zero at the create and update server boundaries", () => {
    expect(
      createDeliverySchema.safeParse({
        ...createBase,
        deliveredWetMassKg: 0,
      }).success,
    ).toBe(false);
    expect(
      updateDeliverySchema.safeParse({
        deliveryId: UUID_A,
        deliveredWetMassKg: 0,
      }).success,
    ).toBe(false);
  });

  it("allows an upcoming delivery to omit its wet mass", () => {
    expect(createDeliverySchema.safeParse(createBase).success).toBe(true);
  });

  it("requires a positive wet mass when a delivery is delivered", () => {
    for (const deliveredWetMassKg of [undefined, null, 0]) {
      expect(
        createDeliverySchema.safeParse({
          ...createBase,
          status: "delivered",
          deliveredWetMassKg,
        }).success,
      ).toBe(false);
    }

    expect(
      createDeliverySchema.safeParse({
        ...createBase,
        status: "delivered",
        deliveredWetMassKg: 1,
      }).success,
    ).toBe(true);
  });

  it("requires a positive wet mass when an update marks a delivery delivered", () => {
    expect(
      updateDeliverySchema.safeParse({
        deliveryId: UUID_A,
        status: "delivered",
        deliveredWetMassKg: null,
      }).success,
    ).toBe(false);
    expect(
      updateDeliverySchema.safeParse({
        deliveryId: UUID_A,
        status: "delivered",
        deliveredWetMassKg: 1,
      }).success,
    ).toBe(true);
  });
});
