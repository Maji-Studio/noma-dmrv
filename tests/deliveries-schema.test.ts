import { describe, expect, it } from "vitest";
import {
  createDeliverySchema,
  updateDeliverySchema,
} from "@/schemas/deliveries";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";
const POSTING_FIELDS = {
  storageLocationId: UUID_B,
  idempotencyKey: "delivery-request",
  basisFingerprint: "delivery-preview",
};

describe("delivery moisture precision", () => {
  it.each([-1, 100, 101])(
    "rejects out-of-range moisture at the create boundary (%s)",
    (moistureContentPercent) => {
      const result = createDeliverySchema.safeParse({
        ...POSTING_FIELDS,
        code: "DEL-001",
        deliveredWetMassKg: 1,
        orderId: UUID_A,
        facilityId: UUID_B,
        deliveryDate: new Date("2026-07-26T00:00:00Z"),
        moistureContentPercent,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ["moistureContentPercent"] }),
          ]),
        );
      }
    },
  );

  it.each([-1, 100, 101])(
    "rejects out-of-range moisture at the update boundary (%s)",
    (moistureContentPercent) => {
      const result = updateDeliverySchema.safeParse({
        deliveryId: UUID_A,
        moistureContentPercent,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ["moistureContentPercent"] }),
          ]),
        );
      }
    },
  );
});

describe("delivery wet mass", () => {
  const createBase = {
    ...POSTING_FIELDS,
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

  it("rejects an upcoming delivery even when its observations are complete", () => {
    const result = createDeliverySchema.safeParse({ ...createBase, status: "upcoming", deliveredWetMassKg: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["status"] }),
        ]),
      );
    }
  });

  it("requires the measured wet mass even when status is omitted", () => {
    const result = createDeliverySchema.safeParse(createBase);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["deliveredWetMassKg"] }),
        ]),
      );
    }
  });

  it.each(["storageLocationId", "idempotencyKey", "basisFingerprint"] as const)("requires %s at the posting boundary", (field) => {
    const result = createDeliverySchema.safeParse({ ...createBase, deliveredWetMassKg: 1, [field]: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: [field] }),
        ]),
      );
    }
  });

  it("rejects an upcoming status in a partial update", () => {
    const result = updateDeliverySchema.safeParse({ deliveryId: UUID_A, status: "upcoming" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["status"] }),
        ]),
      );
    }
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

  it("defers delivered status/mass validation until a partial update is merged", () => {
    expect(
      updateDeliverySchema.safeParse({
        deliveryId: UUID_A,
        status: "delivered",
      }).success,
    ).toBe(true);
    expect(
      updateDeliverySchema.safeParse({
        deliveryId: UUID_A,
        status: "delivered",
        deliveredWetMassKg: null,
      }).success,
    ).toBe(true);
  });
});
