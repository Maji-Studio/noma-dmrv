import { describe, expect, it } from "vitest";
import { matchesSupplierDefaultForDisplay } from "./feedstock-distance-source";

describe("matchesSupplierDefaultForDisplay", () => {
  const supplierDefault = {
    storedDistanceKm: 12,
    storedDistanceSource: "map_estimate" as const,
  };

  it("never relabels a saved leg's provenance, even on a numeric coincidence", () => {
    // DR-002 / FS-26-001 regression: the saved leg says "Route calculation";
    // the edit form must show exactly that, not "Supplier default".
    expect(
      matchesSupplierDefaultForDisplay({
        seededFromSavedLeg: true,
        ...supplierDefault,
        transportDistanceKm: 12,
        draftTransportDistanceSource: "map_estimate",
      }),
    ).toBe(false);
  });

  it("claims the supplier default when the draft was seeded from it", () => {
    expect(
      matchesSupplierDefaultForDisplay({
        seededFromSavedLeg: false,
        ...supplierDefault,
        transportDistanceKm: 12,
        draftTransportDistanceSource: "map_estimate",
      }),
    ).toBe(true);
  });

  it("drops the claim once the distance or source diverges", () => {
    expect(
      matchesSupplierDefaultForDisplay({
        seededFromSavedLeg: false,
        ...supplierDefault,
        transportDistanceKm: 15,
        draftTransportDistanceSource: "map_estimate",
      }),
    ).toBe(false);
    expect(
      matchesSupplierDefaultForDisplay({
        seededFromSavedLeg: false,
        ...supplierDefault,
        transportDistanceKm: 12,
        draftTransportDistanceSource: "manual",
      }),
    ).toBe(false);
  });

  it("never claims documentary provenance as a supplier default", () => {
    expect(
      matchesSupplierDefaultForDisplay({
        seededFromSavedLeg: false,
        storedDistanceKm: 12,
        storedDistanceSource: "document",
        transportDistanceKm: 12,
        draftTransportDistanceSource: "document",
      }),
    ).toBe(false);
  });

  it("requires a stored supplier distance to exist", () => {
    expect(
      matchesSupplierDefaultForDisplay({
        seededFromSavedLeg: false,
        storedDistanceKm: null,
        storedDistanceSource: null,
        transportDistanceKm: 12,
        draftTransportDistanceSource: "manual",
      }),
    ).toBe(false);
  });
});
