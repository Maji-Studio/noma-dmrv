import { describe, expect, it } from "vitest";
import { createSupplierInput, createSupplierApiInput } from "./supplier-input";
import { createCustomerInput, createCustomerApiInput, updateCustomerInput } from "./customer-input";

const location = { name: "Field", country: "TZ", gpsLatitude: -8, gpsLongitude: 34 };
const facilityId = "00000000-0000-4000-8000-000000000001";
describe("party input boundaries", () => {
  it("keeps app contacts while refusing them at the API boundary", () => {
    const input = { name: "Farm", contactEmail: "test@example.com", locations: [location] };
    expect(createSupplierInput.safeParse(input).success).toBe(true);
    expect(createCustomerInput.safeParse(input).success).toBe(true);
    expect(createSupplierApiInput.safeParse(input).success).toBe(false);
    expect(createCustomerApiInput.safeParse(input).success).toBe(false);
  });
  it("rejects nested unknown fields and create codes", () => {
    for (const schema of [createSupplierApiInput, createCustomerApiInput]) {
      expect(schema.safeParse({ name: "Farm", code: "CUS-1", locations: [location] }).success).toBe(false);
      expect(schema.safeParse({ name: "Farm", locations: [{ ...location, contactEmail: "test@example.com" }] }).success).toBe(false);
      expect(schema.safeParse({ name: "Farm", locations: [{ ...location, facilityDistances: [{ facilityId, distanceKm: 10, distanceSource: "manual", extra: true }] }] }).success).toBe(false);
    }
  });
  it("bounds locations, GPS, soil temperatures and distances", () => {
    for (const locations of [[], Array.from({ length: 51 }, () => location), [{ ...location, gpsLongitude: undefined }], [{ ...location, gpsLatitude: 91 }], [{ ...location, defaultSoilTemperatureC: 61 }]]) {
      expect(createCustomerInput.safeParse({ name: "Farm", locations }).success).toBe(false);
    }
    for (const distanceKm of [0, 0.0001, 20001]) {
      expect(createSupplierInput.safeParse({ name: "Farm", locations: [{ ...location, facilityDistances: [{ facilityId, distanceKm, distanceSource: "manual" }] }] }).success).toBe(false);
    }
  });
  it("preserves omission and explicit null in patches", () => {
    const base = { customerId: facilityId, expectedVersion: 1 };
    expect(updateCustomerInput.parse(base)).not.toHaveProperty("cropType");
    expect(updateCustomerInput.parse({ ...base, cropType: null }).cropType).toBeNull();
  });
});
