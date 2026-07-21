import { describe, expect, it } from "vitest";
import { resolveDeliveryDistanceSource } from "./deliveries";

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
