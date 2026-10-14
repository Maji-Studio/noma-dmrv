import { expect, it } from "vitest";
import { representCustomer } from "./customers";
import { representCustomerLocation } from "./customer-locations";

const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";
const at = "2026-10-08T12:00:00.000Z";
const base = { id, code: "CU-1", name: "Customer", version: 1, createdAt: new Date(at), updatedAt: at };
const hidden = { organizationId: "hidden", contactEmail: "hidden@example.test", contactPhone: "hidden", address: "hidden", cropType: "hidden", defaultSoilTemperatureC: 25 };

it("publishes exactly the customer lookup fields without contact or archive fields", () => {
  expect(representCustomer({ ...base, ...hidden })).toEqual({ ...base, createdAt: at });
});

it("publishes a destination's GPS and one-way distance without address or soil temperature", () => {
  const row = { ...base, ...hidden, customerId: id, gpsLatitude: 0, gpsLongitude: null,
    distanceFromFacilityKm: 20, distanceSource: "document" as const, isDefault: true };
  expect(representCustomerLocation(row)).toEqual({ id, customerId: id, name: "Customer", version: 1,
    gpsLatitude: 0, gpsLongitude: null, distanceFromFacilityKm: 20, distanceSource: "document", isDefault: true, createdAt: at, updatedAt: at });
  expect(representCustomerLocation({ ...row, name: null, distanceFromFacilityKm: null, distanceSource: null }))
    .toMatchObject({ name: null, distanceFromFacilityKm: null, distanceSource: null });
});
