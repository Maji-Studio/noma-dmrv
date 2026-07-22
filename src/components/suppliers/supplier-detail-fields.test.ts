import { describe, expect, it } from "vitest";
import { buildSupplierFallbackDistanceField } from "./supplier-detail-fields";

describe("buildSupplierFallbackDistanceField", () => {
  it("shows a saved supplier-level fallback as satisfied", () => {
    expect(buildSupplierFallbackDistanceField(18.5)).toMatchObject({
      label: "Distance to Facility",
      value: "18.5 km",
      certifyRequired: true,
      certifyStatus: "satisfied",
    });
  });

  it("keeps the missing fallback visible with missing certification status", () => {
    expect(buildSupplierFallbackDistanceField(null)).toMatchObject({
      value: null,
      certifyRequired: true,
      certifyStatus: "missing",
    });
  });
});
