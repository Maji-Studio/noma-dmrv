import { describe, expect, it } from "vitest";
import { buildSupplierDefaultLocationDistanceField, resolveSupplierEffectiveDistanceKm } from "./supplier-detail-fields";

describe("default supplier location distance", () => {
  it("uses only the location distance", () => {
    expect(resolveSupplierEffectiveDistanceKm({ defaultLocationDistanceKm: 2.5 })).toBe(2.5);
    for (const distance of [null, 0, Number.NaN]) {
      expect(resolveSupplierEffectiveDistanceKm({ defaultLocationDistanceKm: distance })).toBeNull();
    }
  });
  it("shows a distance without a supplier certification badge", () => {
    expect(buildSupplierDefaultLocationDistanceField({ defaultLocationDistanceKm: 7, locationsLoaded: true }))
      .toEqual({ label: "Distance to facility", value: "7 km" });
  });
  it("keeps the pending and missing states", () => {
    expect(buildSupplierDefaultLocationDistanceField({ defaultLocationDistanceKm: null, locationsLoaded: false }))
      .toEqual({ label: "Distance to facility", value: null, pending: true });
    expect(buildSupplierDefaultLocationDistanceField({ defaultLocationDistanceKm: null, locationsLoaded: true }))
      .toEqual({ label: "Distance to facility", value: "Not set" });
  });
  it("settles an errored read as unavailable without discarding cached data", () => {
    expect(buildSupplierDefaultLocationDistanceField({ defaultLocationDistanceKm: null, locationsLoaded: false, locationsError: true }))
      .toEqual({ label: "Distance to facility", value: null, emptySituation: "notAvailable" });
    expect(buildSupplierDefaultLocationDistanceField({ defaultLocationDistanceKm: 7, locationsLoaded: true, locationsError: true }))
      .toEqual({ label: "Distance to facility", value: "7 km" });
  });
});
