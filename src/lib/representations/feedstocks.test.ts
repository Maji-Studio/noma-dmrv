import { expect, it } from "vitest";
import { representFeedstock } from "./feedstocks";

const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";
const row = {
  id, code: "FS-26-001", version: 1, facilityId: id, status: "complete" as const,
  deliveryDate: new Date("2026-10-06T00:00:00.000Z"), supplierId: id,
  vehicleId: null, feedstockTypeId: id, storageLocationId: id, deliveryGroupId: null,
  massWetKg: 100, massDryKg: 67.5, moistureContentPercent: 32.5,
  gpsLatitude: null, gpsLongitude: null, overrideJustification: null, notes: null,
  createdAt: new Date("2026-10-08T12:00:00.000Z"), updatedAt: new Date("2026-10-08T12:00:00.000Z"),
  supplierName: "Not part of the representation", organizationId: "private-org",
};
it("maps Dates and stored JSON to byte-identical date-only and instant fields", () => {
  const first = representFeedstock(row);
  const replay = representFeedstock(JSON.parse(JSON.stringify(row)));
  expect(JSON.stringify(first)).toBe(JSON.stringify(replay));
  expect(first.deliveryDate).toBe("2026-10-06");
  expect(first.createdAt).toBe("2026-10-08T12:00:00.000Z");
  expect(first).not.toHaveProperty("supplierName");
  expect(first).not.toHaveProperty("organizationId");
});
it("preserves null and zero", () => {
  const data = representFeedstock({ ...row, deliveryDate: null, moistureContentPercent: 0 });
  expect(data.deliveryDate).toBeNull();
  expect(data.moistureContentPercent).toBe(0);
});
