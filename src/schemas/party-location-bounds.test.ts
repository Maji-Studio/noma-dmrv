import { describe, expect, it } from "vitest";
import { createSupplierWithLocationsSchema, supplierLocationFormSchema } from "./suppliers";
import { createCustomerWithLocationsSchema, customerLocationFormSchema } from "./customers";
import { facilityDistanceInputSchema } from "./facility-distances";

const location = { name: "Site", country: "TZ", gpsLatitude: 0, gpsLongitude: 0 };
describe("app party location bounds", () => {
  it.each([createSupplierWithLocationsSchema, createCustomerWithLocationsSchema])("accepts 50 initial locations, refuses 51", schema => {
    const parents = { supplier: { name: "Supplier" }, customer: { name: "Customer" } };
    expect(schema.safeParse({ ...parents, locations: Array(50).fill(location) }).success).toBe(true);
    expect(schema.safeParse({ ...parents, locations: Array(51).fill(location) }).success).toBe(false);
  });
  it.each([supplierLocationFormSchema, customerLocationFormSchema])("bounds text at the runner limits", schema => {
    for (const [field, limit] of [["name", 255], ["country", 100], ["city", 100], ["stateRegion", 100], ["address", 500]] as const) {
      expect(schema.safeParse({ ...location, [field]: "a".repeat(limit) }).success).toBe(true);
      expect(schema.safeParse({ ...location, [field]: "a".repeat(limit + 1) }).success).toBe(false);
    }
  });
  it("bounds distances while retaining numeric form parsing and explicit clears", () => {
    const pair = { facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", distanceSource: "manual" };
    for (const distanceKm of [0.001, 20_000, "0.001", "20000", null, ""]) {
      expect(facilityDistanceInputSchema.safeParse({ ...pair, distanceKm }).success).toBe(true);
    }
    for (const distanceKm of [0.0009, 20_001, 0, -1]) {
      expect(facilityDistanceInputSchema.safeParse({ ...pair, distanceKm }).success).toBe(false);
    }
  });
});
