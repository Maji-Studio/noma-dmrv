import { expect, it } from "vitest";
import { deliveryRepresentationSchema, representDelivery } from "./deliveries";

const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";
const at = "2026-10-08T12:00:00.000Z";
const row = { id, code: "DL-1", version: 1, facilityId: id, orderId: id, storageLocationId: id,
  deliveryDate: "2026-10-08T15:00:00+03:00", deliveredWetMassKg: 1234.567,
  moistureContentPercent: 12.345678, massDryKg: 1000.123, driverId: null, vehicleId: null,
  distanceKmOverride: null, distanceSource: null, distanceNote: null, orderCustomerLocationId: null,
  archivedAt: null, createdAt: new Date(at), updatedAt: at };

it("publishes stored delivery fields with UTC instants and no joined or internal fields", () => {
  const data = representDelivery(Object.assign({}, row, { savedProducts: [BigInt(1)], driverName: "hidden", evidenceCount: 3 }));
  expect(data).toEqual({ id, code: "DL-1", version: 1, facilityId: id, orderId: id, storageLocationId: id,
    deliveredAt: at, deliveredWetMassKg: 1234.567, moisturePercent: 12.345678, dryBiocharKg: 1000.123,
    driverId: null, vehicleId: null, distanceKmOverride: null, distanceSource: null, distanceNote: null,
    destinationCustomerLocationId: null, archivedAt: null, createdAt: at, updatedAt: at });
  expect(Object.keys(data).sort()).toEqual(Object.keys(deliveryRepresentationSchema.shape).sort());
});

it("preserves nullable stored masses and the stored distance precision", () => {
  const data = representDelivery({ ...row, moistureContentPercent: null, massDryKg: null,
    distanceKmOverride: 123.45679, distanceSource: "document" as const, distanceNote: "Route evidence",
    orderCustomerLocationId: id, driverId: id, vehicleId: id, archivedAt: new Date(at) });
  expect(data).toMatchObject({ moisturePercent: null, dryBiocharKg: null,
    distanceKmOverride: 123.45679, destinationCustomerLocationId: id, archivedAt: at });
  expect(deliveryRepresentationSchema.shape.moisturePercent.description).toContain("6 decimal places");
  expect(deliveryRepresentationSchema.shape.dryBiocharKg.description).toContain("3 decimal places");
});

it("requires delivered wet mass", () => {
  expect(deliveryRepresentationSchema.safeParse({ ...representDelivery(row), deliveredWetMassKg: null }).success).toBe(false);
});
