import { describe, expect, it } from "vitest";
import { buildSupplierFallbackDistanceField } from "./supplier-detail-fields";

describe("buildSupplierFallbackDistanceField", () => {
  it("shows a saved supplier-level fallback as satisfied", () => {
    expect(buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm: null,
      legacySupplierDistanceKm: 18.5,
      locationsLoaded: true,
    })).toMatchObject({
      label: "Distance to Facility",
      value: "18.5 km",
      certifyRequired: true,
      certifyStatus: "satisfied",
    });
  });

  it("prefers the default supplier-location distance over the legacy fallback", () => {
    expect(buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm: 7,
      legacySupplierDistanceKm: 18.5,
      locationsLoaded: true,
    })).toMatchObject({
      value: "7 km",
      certifyRequired: true,
      certifyStatus: "satisfied",
    });
  });

  it("ignores invalid location distances before using a valid legacy fallback", () => {
    expect(buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm: Number.NaN,
      legacySupplierDistanceKm: 18.5,
      locationsLoaded: true,
    })).toMatchObject({
      value: "18.5 km",
      certifyStatus: "satisfied",
    });

    expect(buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm: 0,
      legacySupplierDistanceKm: Number.NaN,
      locationsLoaded: true,
    })).toMatchObject({
      value: null,
      certifyStatus: "missing",
    });
  });

  it("stays neutral until the supplier locations query has resolved", () => {
    expect(buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm: null,
      legacySupplierDistanceKm: 18.5,
      locationsLoaded: false,
    })).toMatchObject({
      value: null,
      certifyRequired: true,
      certifyStatus: "neutral",
    });
  });

  it("keeps the missing fallback visible with missing certification status", () => {
    expect(buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm: null,
      legacySupplierDistanceKm: null,
      locationsLoaded: true,
    })).toMatchObject({
      value: null,
      certifyRequired: true,
      certifyStatus: "missing",
    });
  });
});
