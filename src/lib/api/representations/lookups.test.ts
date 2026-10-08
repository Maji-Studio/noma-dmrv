import { describe, expect, it } from "vitest";
import { z } from "zod";
import { facilityEtag, facilityRepresentationSchema, representFacility } from "./facilities";
import { supplierEtag, supplierRepresentationSchema, representSupplier } from "./suppliers";
import { feedstockTypeEtag, feedstockTypeRepresentationSchema, representFeedstockType } from "./feedstock-types";
import { storageLocationEtag, storageLocationRepresentationSchema, representStorageLocation } from "./storage-locations";
import { vehicleEtag, vehicleRepresentationSchema, representVehicle } from "./vehicles";
import { driverEtag, driverRepresentationSchema, representDriver } from "./drivers";
import { supplierLocationRepresentationSchema, representSupplierLocation } from "./supplier-locations";

const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";
const instant = "2026-10-08T12:00:00.000Z";
const archived = "2026-10-09T12:00:00.000Z";
const base = { id, code: "LOOKUP-001", name: "Lookup name", createdAt: new Date(instant), updatedAt: new Date(instant) };
const expected = { ...base, archivedAt: null, createdAt: instant, updatedAt: instant };
const privateFields = {
  organizationId: "private-org", contactName: "Hidden", contactEmail: "hidden@example.test", contactPhone: "Hidden",
  licenseNumber: "Hidden", userId: "private-user", address: "Hidden", notes: "Hidden", cursorCreatedAt: instant,
};

// Independent expected field sets ensure adding row columns never expands the API.
const cases = [
  { name: "facility", schema: facilityRepresentationSchema,
    map: () => representFacility({ ...base, ...privateFields, version: 7, timezone: "Africa/Dar_es_Salaam" }),
    json: () => representFacility({ ...base, version: 7, timezone: "Africa/Dar_es_Salaam", createdAt: instant, updatedAt: instant }),
    expected: { ...expected, version: 7, timeZone: "Africa/Dar_es_Salaam" } },
  { name: "supplier", schema: supplierRepresentationSchema,
    map: () => representSupplier({ ...base, ...privateFields, version: 7 }),
    json: () => representSupplier({ ...base, version: 7, createdAt: instant, updatedAt: instant }),
    expected: { ...expected, version: 7 } },
  { name: "feedstock type", schema: feedstockTypeRepresentationSchema,
    map: () => representFeedstockType({ ...base, ...privateFields, version: 7, category: "forestry", usage: "pyrolysis" }),
    json: () => representFeedstockType({ ...base, version: 7, category: "forestry", usage: "pyrolysis", createdAt: instant, updatedAt: instant }),
    expected: { ...expected, version: 7, category: "forestry", usage: "pyrolysis" } },
  { name: "storage location", schema: storageLocationRepresentationSchema,
    map: () => representStorageLocation({ ...base, ...privateFields, version: 7, facilityId: id, type: "feedstock_bin", capacityKg: 0, feedstockTypeId: null }),
    json: () => representStorageLocation({ ...base, version: 7, facilityId: id, type: "feedstock_bin", capacityKg: 0, feedstockTypeId: null, createdAt: instant, updatedAt: instant }),
    expected: { ...expected, version: 7, facilityId: id, type: "feedstock_bin", capacityKg: 0, feedstockTypeId: null } },
  { name: "vehicle", schema: vehicleRepresentationSchema,
    map: () => representVehicle({ ...base, version: 7, ...privateFields, identifier: "T 123 ABC", vehicleType: "truck" }),
    json: () => representVehicle({ ...base, version: 7, identifier: "T 123 ABC", vehicleType: "truck", createdAt: instant, updatedAt: instant }),
    expected: { ...expected, version: 7, identifier: "T 123 ABC", vehicleType: "truck" } },
  { name: "driver", schema: driverRepresentationSchema,
    map: () => representDriver({ ...base, version: 7, ...privateFields }),
    json: () => representDriver({ ...base, version: 7, createdAt: instant, updatedAt: instant }),
    expected: { ...expected, version: 7 } },
  { name: "supplier location", schema: supplierLocationRepresentationSchema,
    map: () => representSupplierLocation({ ...base, ...privateFields, name: null, version: 7, supplierId: id, gpsLatitude: 0, gpsLongitude: null }),
    json: () => representSupplierLocation({ ...base, name: null, version: 7, supplierId: id, gpsLatitude: 0, gpsLongitude: null, createdAt: instant, updatedAt: instant }),
    expected: { id, name: null, version: 7, supplierId: id, gpsLatitude: 0, gpsLongitude: null, archivedAt: null, createdAt: instant, updatedAt: instant } },
];

describe.each(cases)("$name representation", ({ schema, map, json, expected: output }) => {
  it("projects the explicit intake fields and preserves null and zero", () => {
    expect(map()).toEqual(output);
    expect(JSON.stringify(json())).toBe(JSON.stringify(map()));
  });
  it("describes every published field", () => {
    const published = z.toJSONSchema(schema);
    for (const field of Object.values(published.properties ?? {})) expect(typeof field === "object" && field.description).toBeTruthy();
  });
});

it("serializes archive Dates and stored instants, and emits strong version/revision ETags", () => {
  expect(representFacility({ ...base, version: 7, timezone: "UTC", archivedAt: new Date(archived) }).archivedAt).toBe(archived);
  expect(representFeedstockType({ ...base, version: 7, category: "forestry", usage: "pyrolysis", archivedAt: archived }).archivedAt).toBe(archived);
  expect(representStorageLocation({ ...base, version: 7, facilityId: id, type: "biochar_bin", capacityKg: null, feedstockTypeId: null, archivedAt: new Date(archived) })).toMatchObject({ archivedAt: archived, capacityKg: null });
  for (const etag of [facilityEtag, supplierEtag, feedstockTypeEtag, storageLocationEtag, vehicleEtag, driverEtag]) expect(etag({ version: 7 })).toBe('"7.1"');
  expect(representVehicle({ ...base, version: 7, vehicleType: "truck", identifier: null }).identifier).toBeNull();
});
