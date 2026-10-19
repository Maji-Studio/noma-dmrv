import { expect, it } from "vitest";
import { representSupplier } from "./suppliers";
import { representCustomer } from "./customers";
import { representSupplierLocation } from "./supplier-locations";
import { representCustomerLocation } from "./customer-locations";

const id = "11111111-1111-4111-8111-111111111111";
const instant = new Date("2026-10-16T12:00:00Z");
const row = { id, code: "PARTY-1", name: "Party", version: 1, createdAt: instant, updatedAt: instant, archivedAt: instant };
it("publishes party archive instants and permitted metadata without contacts", () => {
  const supplier = representSupplier({ ...row, sourceRegion: "Region", email: "private" } as Parameters<typeof representSupplier>[0]);
  const customer = representCustomer({ ...row, cropType: "Coffee", phone: "private" } as Parameters<typeof representCustomer>[0]);
  expect(supplier).toMatchObject({ sourceRegion: "Region", archivedAt: instant.toISOString() });
  expect(customer).toMatchObject({ cropType: "Coffee", archivedAt: instant.toISOString() });
  expect(supplier).not.toHaveProperty("email");
  expect(customer).not.toHaveProperty("phone");
});
it("publishes location places and site defaults without private address fields", () => {
  const location = { ...row, country: "TZ", stateRegion: "Region", city: "City", isDefault: true, gpsLatitude: -8, gpsLongitude: 34, facilityDistances: [], address: "Private", email: "Private" };
  const supplier = representSupplierLocation({ ...location, supplierId: id });
  const customer = representCustomerLocation({ ...location, customerId: id, siteDescription: "North field", defaultSoilTemperatureC: 22 });
  expect(supplier).toMatchObject({ country: "TZ", stateRegion: "Region", city: "City", isDefault: true, archivedAt: null });
  expect(customer).toMatchObject({ country: "TZ", siteDescription: "North field", defaultSoilTemperatureC: 22 });
  for (const value of [supplier, customer]) {
    expect(value).not.toHaveProperty("address");
    expect(value).not.toHaveProperty("email");
    expect(value.facilityDistances).toEqual([]);
  }
  expect(customer.archivedAt).toBe(instant.toISOString());
  expect(representCustomerLocation({ ...location, archivedAt: null, customerId: id,
    siteDescription: null, defaultSoilTemperatureC: null }).archivedAt).toBeNull();
  expect(representCustomerLocation({ ...location, archivedAt: instant.toISOString(), customerId: id,
    siteDescription: null, defaultSoilTemperatureC: null }).archivedAt).toBe(instant.toISOString());
});
