import { describe, expect, it } from "vitest";
import { addCustomerLocationInput, updateCustomerLocationInput, customerLocationVersionInput } from "./customer-location-input";
const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const version = { locationId: id, expectedVersion: 1 };
describe("customer location operation inputs", () => {
  it("requires a parent and a complete site on add", () => {
    expect(addCustomerLocationInput.safeParse({ customerId: id }).success).toBe(false);
    expect(addCustomerLocationInput.safeParse({ customerId: id, name: "Field", country: "TZ", gpsLatitude: 0, gpsLongitude: 0 }).success).toBe(true);
  });
  it("refuses empty patches, unknown fields, half GPS and clearing required fields", () => {
    for (const patch of [{}, { name: undefined }, { unknown: true }, { country: null }, { name: null }, { gpsLatitude: 1 }, { gpsLatitude: null, gpsLongitude: null }]) {
      expect(updateCustomerLocationInput.safeParse({ ...version, ...patch }).success).toBe(false);
    }
    expect(updateCustomerLocationInput.parse({ ...version, address: null })).toEqual({ ...version, address: null });
    expect(updateCustomerLocationInput.parse({ ...version, gpsLatitude: 0, gpsLongitude: 0 })).toEqual({ ...version, gpsLatitude: 0, gpsLongitude: 0 });
  });
  it("allows app parent discovery and an explicit parent for restricted callers", () => {
    expect(customerLocationVersionInput.parse(version)).toEqual(version);
    expect(customerLocationVersionInput.parse({ ...version, customerId: id })).toEqual({ ...version, customerId: id });
  });
});
