import { describe, expect, it } from "vitest";
import {
  deliveryFormSchema,
  resolveDeliveryDistanceSource,
} from "./deliveries";

const ORDER_ID = "00000000-0000-4000-8000-000000000001";

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
    deliveryDate: new Date("2026-07-31"),
    moistureContentPercent: 20,
  };

  it("requires the independently measured product moisture", () => {
    const result = deliveryFormSchema.safeParse({
      orderId: ORDER_ID,
      deliveryDate: new Date("2026-07-31"),
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
    ["deliveredWetMassKg", -1, "Wet mass must be 0 or more"],
    ["distanceKmOverride", -1, "Distance must be 0 or more"],
    [
      "moistureContentPercent",
      -1,
      "Moisture content must be 0% or more",
    ],
    [
      "moistureContentPercent",
      101,
      "Moisture content must be 100% or less",
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

  it("accepts an ordinary delivery without truck observations", () => {
    expect(deliveryFormSchema.safeParse(baseDelivery).success).toBe(true);
  });
});
