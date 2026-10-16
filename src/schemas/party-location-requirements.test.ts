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
    for (const distance of [undefined, 0, -1, "0"]) expect(schema.safeParse({ ...input, facilityDistances: [{ facilityId: id, distanceKm: distance, distanceSource: "manual" }] }).success).toBe(false);
    for (const distance of [null, "", 1]) expect(schema.safeParse({ ...input, facilityDistances: [{ facilityId: id, distanceKm: distance, distanceSource: "manual" }] }).success).toBe(true);
  });
  it.each([supplierLocationFormSchema, customerLocationFormSchema, createSupplierLocationSchema, createCustomerLocationSchema])("preserves omitted arrays, rejects omitted pair distances and normalizes empty form distances", (schema) => {
    const input = { ...location, supplierId: id, customerId: id };
    expect(schema.parse(input).facilityDistances).toBeUndefined();
    expect(schema.safeParse({ ...input, facilityDistances: [{ facilityId: id, distanceSource: "manual" }] }).success).toBe(false);
    for (const distance of [null, "", "   "]) {
      expect(schema.parse({ ...input, facilityDistances: [{ facilityId: id, distanceKm: distance, distanceSource: "manual" }] }).facilityDistances?.[0]?.distanceKm).toBeNull();
    }
    expect(schema.parse({ ...input, facilityDistances: [{ facilityId: id, distanceKm: "1.5", distanceSource: "manual" }] }).facilityDistances?.[0]?.distanceKm).toBe(1.5);
  });
  it.each([updateSupplierLocationSchema, updateCustomerLocationSchema])("preserves omitted patch distances and clears explicit empty values", (schema) => {
    const input = { locationId: id, expectedVersion: 1 };
    expect(schema.parse(input).facilityDistances?.[0]?.distanceKm).toBeUndefined();
    expect(schema.parse({ ...input, facilityDistances: undefined }).facilityDistances?.[0]?.distanceKm).toBeUndefined();
    for (const distance of [null, "", "   "]) {
      expect(schema.parse({ ...input, facilityDistances: [{ facilityId: id, distanceKm: distance, distanceSource: "manual" }] }).facilityDistances?.[0]?.distanceKm).toBeNull();
    }
  });
  it.each([createSupplierWithLocationsSchema, createCustomerWithLocationsSchema])("requires at least one location", (schema) => {
    const input = { supplier: { name: "Supplier" }, customer: { name: "Customer" } };
    expect(schema.safeParse(input).success).toBe(false);
    expect(schema.safeParse({ ...input, locations: [] }).success).toBe(false);
    expect(schema.parse({ ...input, locations: [location] }).locations[0].facilityDistances).toBeUndefined();
  });
});
