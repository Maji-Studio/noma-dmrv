import { describe, expect, it } from "vitest";
import { createFacilitySchema, updateFacilitySchema } from "./facilities";
import { createSupplierLocationSchema, createSupplierWithLocationsSchema, supplierLocationFormSchema, updateSupplierLocationSchema } from "./suppliers";
import { createCustomerLocationSchema, createCustomerWithLocationsSchema, customerLocationFormSchema, updateCustomerLocationSchema } from "./customers";

const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const location = { name: "Site", country: "Tanzania", gpsLatitude: 0, gpsLongitude: 0 };

describe("required site data", () => {
  it("requires facility GPS on create", () => {
    const input = { name: "Facility", country: "Tanzania", timezone: "Africa/Nairobi" };
    expect(createFacilitySchema.safeParse(input).success).toBe(false);
    expect(createFacilitySchema.safeParse({ ...input, gpsLatitude: 0, gpsLongitude: 0 }).success).toBe(true);
  });
  it.each([updateFacilitySchema, updateSupplierLocationSchema, updateCustomerLocationSchema])("preserves omitted GPS but refuses clearing or half a pair", (schema) => {
    const input = { facilityId: id, locationId: id, expectedVersion: 1 };
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, gpsLatitude: null, gpsLongitude: null }).success).toBe(false);
    expect(schema.safeParse({ ...input, gpsLatitude: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...input, gpsLatitude: 0, gpsLongitude: 0 }).success).toBe(true);
  });
  it.each([supplierLocationFormSchema, customerLocationFormSchema, updateSupplierLocationSchema, updateCustomerLocationSchema])("accepts only positive recorded distances", (schema) => {
    const input = { ...location, locationId: id, expectedVersion: 1 };
    for (const distance of [0, -1, "0"]) expect(schema.safeParse({ ...input, distanceFromFacilityKm: distance }).success).toBe(false);
    for (const distance of [undefined, null, "", 1]) expect(schema.safeParse({ ...input, distanceFromFacilityKm: distance }).success).toBe(true);
  });
  it.each([supplierLocationFormSchema, customerLocationFormSchema, createSupplierLocationSchema, createCustomerLocationSchema])("normalizes omitted and empty create/form distances to null", (schema) => {
    const input = { ...location, supplierId: id, customerId: id };
    expect(schema.parse(input).distanceFromFacilityKm).toBeNull();
    for (const distance of [undefined, null, "", "   "]) {
      expect(schema.parse({ ...input, distanceFromFacilityKm: distance }).distanceFromFacilityKm).toBeNull();
    }
    expect(schema.parse({ ...input, distanceFromFacilityKm: "1.5" }).distanceFromFacilityKm).toBe(1.5);
  });
  it.each([updateSupplierLocationSchema, updateCustomerLocationSchema])("preserves omitted patch distances and clears explicit empty values", (schema) => {
    const input = { locationId: id, expectedVersion: 1 };
    expect(schema.parse(input).distanceFromFacilityKm).toBeUndefined();
    expect(schema.parse({ ...input, distanceFromFacilityKm: undefined }).distanceFromFacilityKm).toBeUndefined();
    for (const distance of [null, "", "   "]) {
      expect(schema.parse({ ...input, distanceFromFacilityKm: distance }).distanceFromFacilityKm).toBeNull();
    }
  });
  it.each([createSupplierWithLocationsSchema, createCustomerWithLocationsSchema])("requires at least one location", (schema) => {
    const input = { supplier: { name: "Supplier" }, customer: { name: "Customer" } };
    expect(schema.safeParse(input).success).toBe(false);
    expect(schema.safeParse({ ...input, locations: [] }).success).toBe(false);
    expect(schema.parse({ ...input, locations: [location] }).locations[0].distanceFromFacilityKm).toBeNull();
  });
});
