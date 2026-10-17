import { describe, expect, it } from "vitest";
import { addSupplierLocationApiInput, updateSupplierLocationApiInput, supplierLocationApiVersionInput, addSupplierLocationInput, updateSupplierLocationInput, supplierLocationVersionInput } from "./supplier-location-input";
const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const version = { locationId: id, expectedVersion: 1 };
describe("supplier location operation inputs", () => {
  it("requires a parent and a complete site on add", () => {
    expect(addSupplierLocationInput.safeParse({ supplierId: id }).success).toBe(false);
    expect(addSupplierLocationInput.safeParse({ supplierId: id, country: "TZ", gpsLatitude: 0, gpsLongitude: 0 }).success).toBe(true);
  });
  it("refuses empty patches, unknown fields, half GPS and clearing required fields", () => {
    for (const patch of [{}, { name: undefined }, { unknown: true }, { country: null }, { gpsLatitude: 1 }, { gpsLatitude: null, gpsLongitude: null }]) {
      expect(updateSupplierLocationInput.safeParse({ ...version, ...patch }).success).toBe(false);
    }
    expect(updateSupplierLocationInput.parse({ ...version, name: null })).toEqual({ ...version, name: null });
    expect(updateSupplierLocationInput.parse({ ...version, gpsLatitude: 0, gpsLongitude: 0 })).toEqual({ ...version, gpsLatitude: 0, gpsLongitude: 0 });
  });
  it("allows app parent discovery and an explicit parent for restricted callers", () => {
    expect(supplierLocationVersionInput.parse(version)).toEqual(version);
    expect(supplierLocationVersionInput.parse({ ...version, supplierId: id })).toEqual({ ...version, supplierId: id });
  });
});

describe("restricted supplier location API inputs", () => {
  const parent = { supplierId: id };
  const target = { ...parent, ...version };
  it("requires the parent on every mutation and canonicalizes UUIDs", () => {
    expect(supplierLocationApiVersionInput.safeParse(version).success).toBe(false);
    expect(updateSupplierLocationApiInput.safeParse({ ...version, city: "Site" }).success).toBe(false);
    expect(addSupplierLocationApiInput.parse({ supplierId: id.toUpperCase(), name: "Field", country: "TZ", gpsLatitude: 0, gpsLongitude: 0 }).supplierId).toBe(id);
    expect(supplierLocationApiVersionInput.parse({ ...target, locationId: id.toUpperCase() }).locationId).toBe(id);
  });
  it("rejects app-only address, unknown fields, empty PATCH and half GPS", () => {
    for (const patch of [{ address: "Private" }, { unknown: true }, {}, { gpsLatitude: 0 }]) {
      expect(updateSupplierLocationApiInput.safeParse({ ...target, ...patch }).success).toBe(false);
    }
    expect(addSupplierLocationApiInput.safeParse({ ...parent, name: "Field", country: "TZ", gpsLatitude: 0, gpsLongitude: 0, address: "Private" }).success).toBe(false);
  });
  it("permits clearing optional location names and places", () => {
    expect(updateSupplierLocationApiInput.parse({ ...target, name: null, city: null })).toEqual({ ...target, name: null, city: null });
  });
});
