import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SupplierFallbackDistanceSummary } from "./supplier-detail";
import { buildSupplierFallbackDistanceField } from "./supplier-detail-fields";

const supplier = {
  code: "SUP-26-001",
  distanceToFacilityKm: null,
};

const locations = [
  {
    isDefault: true,
    distanceFromFacilityKm: 2.5,
  },
];

describe("supplier distance surface parity", () => {
  it("renders the list and detail value with identical certification status", () => {
    const listSurfaceField = buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm:
        locations.find((location) => location.isDefault)
          ?.distanceFromFacilityKm ?? null,
      legacySupplierDistanceKm: supplier.distanceToFacilityKm,
      locationsLoaded: true,
    });
    const detailSurfaceField = buildSupplierFallbackDistanceField({
      defaultLocationDistanceKm:
        locations.find((location) => location.isDefault)
          ?.distanceFromFacilityKm ?? null,
      legacySupplierDistanceKm: supplier.distanceToFacilityKm,
      locationsLoaded: true,
    });

    expect(detailSurfaceField).toMatchObject({
      value: listSurfaceField.value,
      certifyStatus: listSurfaceField.certifyStatus,
    });
    expect(listSurfaceField).toMatchObject({
      value: "2.5 km",
      certifyStatus: "satisfied",
    });

    const html = renderToStaticMarkup(
      <SupplierFallbackDistanceSummary field={detailSurfaceField} />,
    );
    expect(html).toContain("2.5 km");
    expect(html).toContain("Required for certification. Provided.");
  });
});
