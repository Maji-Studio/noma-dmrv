import { describe, expect, it } from "vitest";
import { buildSupplierFallbackDistanceField, resolveSupplierEffectiveDistanceKm } from "./supplier-detail-fields";

describe("default supplier location distance", () => {
  it("uses only the location distance", () => {
    expect(resolveSupplierEffectiveDistanceKm({ defaultLocationDistanceKm: 2.5 })).toBe(2.5);
    for (const distance of [null, 0, Number.NaN]) {
      expect(resolveSupplierEffectiveDistanceKm({ defaultLocationDistanceKm: distance })).toBeNull();
    }
  });
  it("shows a distance without a supplier certification badge", () => {
    expect(buildSupplierFallbackDistanceField({ defaultLocationDistanceKm: 7, locationsLoaded: true }))
      .toEqual({ label: "Distance to facility", value: "7 km" });
  });
  it("keeps the pending and missing states", () => {
    expect(buildSupplierFallbackDistanceField({ defaultLocationDistanceKm: null, locationsLoaded: false }))
      .toEqual({ label: "Distance to facility", value: null, pending: true });
    expect(buildSupplierFallbackDistanceField({ defaultLocationDistanceKm: null, locationsLoaded: true }))
      .toEqual({ label: "Distance to facility", value: "Not set" });
  });
});
