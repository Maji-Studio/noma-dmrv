import { expect, it } from "vitest";
import { representCustomer } from "./customers";
import { representCustomerLocation } from "./customer-locations";

const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";
const at = "2026-10-08T12:00:00.000Z";
const base = { id, code: "CU-1", name: "Customer", version: 1, archivedAt: null, createdAt: new Date(at), updatedAt: at };
const hidden = { organizationId: "hidden", contactEmail: "hidden@example.test", contactPhone: "hidden", address: "hidden", cropType: "hidden", defaultSoilTemperatureC: 25 };

it("publishes exactly the customer lookup fields with crop type and archive state but no contacts", () => {
  expect(representCustomer({ ...base, ...hidden })).toEqual({ ...base, cropType: "hidden", createdAt: at });
});

it("publishes a destination's GPS and one-way distance with site defaults but no private address field", () => {
  const row = { ...base, ...hidden, country: "TZ", stateRegion: null, city: null, siteDescription: "Field", customerId: id, gpsLatitude: 0, gpsLongitude: 0,
    facilityDistances: [{ facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", distanceKm: 20, distanceSource: "document" as const }], isDefault: true };
  expect(representCustomerLocation(row)).toEqual({ id, customerId: id, name: "Customer", version: 1,
    country: "TZ", stateRegion: null, city: null, siteDescription: "Field", defaultSoilTemperatureC: 25, gpsLatitude: 0, gpsLongitude: 0, facilityDistances: [{ facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", distanceKm: 20, distanceSource: "document" }], isDefault: true, archivedAt: null, createdAt: at, updatedAt: at });
  expect(representCustomerLocation({ ...row, facilityDistances: [], }))
    .toMatchObject({ facilityDistances: [], });
});
