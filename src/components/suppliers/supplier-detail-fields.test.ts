import { describe, expect, it } from "vitest";
import {
  buildSupplierFallbackDistanceField,
  resolveSupplierEffectiveDistanceKm,
} from "./supplier-detail-fields";

describe("resolveSupplierEffectiveDistanceKm", () => {
  // DR-002 / SUP-26-001 regression: the detail-page summary card read the raw
  // legacy column and showed "Not set" while the locations table on the same
  // page showed the default location's 2.5 km. Both the list side sheet and
  // the detail page now resolve through this single derivation.
  it("resolves the default location distance when the legacy column is unset", () => {
    expect(
      resolveSupplierEffectiveDistanceKm({
        defaultLocationDistanceKm: 2.5,
        legacySupplierDistanceKm: null,
      }),
    ).toBe(2.5);
  });

  it("prefers the default location over the legacy column", () => {
    expect(
      resolveSupplierEffectiveDistanceKm({
        defaultLocationDistanceKm: 7,
        legacySupplierDistanceKm: 18.5,
      }),
    ).toBe(7);
  });

  it("falls back to the legacy column and returns null when neither is valid", () => {
    expect(
      resolveSupplierEffectiveDistanceKm({
        defaultLocationDistanceKm: null,
        legacySupplierDistanceKm: 18.5,
      }),
    ).toBe(18.5);
    expect(
      resolveSupplierEffectiveDistanceKm({
        defaultLocationDistanceKm: 0,
        legacySupplierDistanceKm: null,
      }),
    ).toBeNull();
  });
});

describe("buildSupplierFallbackDistanceField", () => {
  it("shows a saved supplier-level fallback as satisfied", () => {
    expect(buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm: null,
      legacySupplierDistanceKm: 18.5,
      locationsLoaded: true,
    })).toMatchObject({
      label: "Distance to facility",
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
      label: "Distance to facility",
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
