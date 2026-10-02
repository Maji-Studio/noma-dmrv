import { describe, expect, it } from "vitest";
import { supplierLocationFormSchema } from "./suppliers";
import { transportLegFormSchema } from "./transport-legs";

// Controller-backed fields clear with `null` (undefined would fall back to the
// default value), so the schemas must read null as "missing", not as a value.
describe("clearing controller-backed fields with null", () => {
  it("reports a cleared transport leg distance as required", () => {
    const shape = transportLegFormSchema.shape.distanceKm;
    const result = shape.safeParse(null);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Distance is required");
  });

  it("reports cleared supplier GPS coordinates as missing", () => {
    expect(supplierLocationFormSchema.shape.gpsLatitude.safeParse(null).success).toBe(false);
    expect(supplierLocationFormSchema.shape.gpsLongitude.safeParse(null).success).toBe(false);
  });

  it("accepts a cleared supplier distance as no distance", () => {
    expect(supplierLocationFormSchema.shape.distanceFromFacilityKm.safeParse(null).success).toBe(true);
  });
});
