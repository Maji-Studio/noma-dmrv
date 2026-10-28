import { describe, expect, it } from "vitest";
import { DELIVERY_CODE_MAX_LENGTH, DELIVERY_DISTANCE_MESSAGE, DELIVERY_DISTANCE_NOTE_MAX_LENGTH, updateDeliveryApiInput } from "./delivery-input";
import {
  deliveryFormSchema,
  updateDeliverySchema,
  resolveDeliveryDistanceSource,
} from "./deliveries";

const ORDER_ID = "00000000-0000-4000-8000-000000000001";

it("keeps app and API delivery code and distance note limits aligned", () => {
  const input = { deliveryId: ORDER_ID, expectedVersion: 1 };
  for (const schema of [updateDeliverySchema, updateDeliveryApiInput]) {
    expect(schema.safeParse({ ...(schema === updateDeliverySchema ? input : { expectedVersion: 1 }), code: "A".repeat(DELIVERY_CODE_MAX_LENGTH), distanceNote: "a".repeat(DELIVERY_DISTANCE_NOTE_MAX_LENGTH) }).success).toBe(true);
    for (const changes of [{ code: "A".repeat(DELIVERY_CODE_MAX_LENGTH + 1) }, { code: "lowercase" }, { distanceNote: "a".repeat(DELIVERY_DISTANCE_NOTE_MAX_LENGTH + 1) }]) {
      expect(schema.safeParse({ ...(schema === updateDeliverySchema ? input : { expectedVersion: 1 }), ...changes }).success).toBe(false);
    }
  }
});

describe("resolveDeliveryDistanceSource", () => {
  it("persists trip-specific Document provenance without a distance override", () => {
    expect(resolveDeliveryDistanceSource(null, "document")).toBe("document");
  });

  it("preserves the null-override invariant for non-documentary sources", () => {
    expect(resolveDeliveryDistanceSource(null, "manual")).toBeNull();
    expect(resolveDeliveryDistanceSource(null, "map_estimate")).toBeNull();
  });

  it("defaults a typed override without provenance to Manual", () => {
    expect(resolveDeliveryDistanceSource(25, undefined)).toBe("manual");
  });
});

describe("delivery range validation copy", () => {
  const baseDelivery = {
    orderId: ORDER_ID,
    storageLocationId: ORDER_ID,
    idempotencyKey: "delivery-request",
    basisFingerprint: "delivery-preview",
    deliveredWetMassKg: 1,
    deliveryDate: new Date("2026-07-31"),
    moistureContentPercent: 20,
  };

  it("requires the independently measured product moisture", () => {
    const result = deliveryFormSchema.safeParse({
      ...baseDelivery,
      moistureContentPercent: undefined,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.find(
        (issue) => issue.path[0] === "moistureContentPercent",
      )?.message,
    ).toBe("Biochar product moisture is required");
  });

  it.each([
    ["deliveredWetMassKg", -1, "Wet mass must be at least 0.001 kg"],
    ["distanceKmOverride", -1, DELIVERY_DISTANCE_MESSAGE],
    ["distanceKmOverride", 0, DELIVERY_DISTANCE_MESSAGE],
    [
      "moistureContentPercent",
      -1,
      "Moisture content must be 0% or more",
    ],
    [
      "moistureContentPercent",
      101,
      "Moisture must be below 100%",
    ],
  ] as const)("describes the %s range naturally", (field, value, message) => {
    const result = deliveryFormSchema.safeParse({
      ...baseDelivery,
      [field]: value,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.find((issue) => issue.path[0] === field)?.message,
    ).toBe(message);
  });

  it("accepts a completed truck observation and defaults its status to delivered", () => {
    const result = deliveryFormSchema.parse(baseDelivery);
    expect(result.status).toBe("delivered");
  });

  it("rejects an upcoming delivery even with complete truck observations", () => {
    const result = deliveryFormSchema.safeParse({ ...baseDelivery, status: "upcoming" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["status"] }),
        ]),
      );
    }
  });

  it("rejects 100% moisture because positive dry stock cannot be allocated", () => {
    const result = deliveryFormSchema.safeParse({ ...baseDelivery, moistureContentPercent: 100 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["moistureContentPercent"], message: "Moisture must be below 100%" }),
        ]),
      );
    }
  });

  it("rejects zero delivered wet mass and an omitted observation", () => {
    const result = deliveryFormSchema.safeParse({
      ...baseDelivery,
      deliveredWetMassKg: 0,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.find(
        (issue) => issue.path[0] === "deliveredWetMassKg",
      )?.message,
    ).toBe("Wet mass must be at least 0.001 kg");
    expect(deliveryFormSchema.safeParse({ ...baseDelivery, deliveredWetMassKg: undefined }).success).toBe(false);
  });

  it("requires a positive wet mass when the form status is delivered", () => {
    const result = deliveryFormSchema.safeParse({
      ...baseDelivery,
      status: "delivered",
      deliveredWetMassKg: undefined,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.find(
        (issue) => issue.path[0] === "deliveredWetMassKg",
      )?.message,
    ).toBe(
      "Enter a wet mass of at least 0.001 kg before marking this delivery as delivered",
    );
  });
});

it("preserves omitted update distances and accepts only positive overrides or explicit clears", () => {
  const input = { deliveryId: ORDER_ID, expectedVersion: 1 };
  expect(updateDeliverySchema.parse(input).distanceKmOverride).toBeUndefined();
  expect(updateDeliverySchema.parse({ ...input, distanceKmOverride: null }).distanceKmOverride).toBeNull();
  expect(updateDeliverySchema.parse({ ...input, distanceKmOverride: 25 }).distanceKmOverride).toBe(25);
  for (const distanceKmOverride of [0, -1]) {
    expect(updateDeliverySchema.safeParse({ ...input, distanceKmOverride }).success).toBe(false);
  }
});
