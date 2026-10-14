import { describe, expect, it } from "vitest";
import { recordDeliveryInput, updateDeliveryApiInput } from "./delivery-input";

const id = "00000000-0000-4000-8000-000000000001";
const input = { orderId: id, storageLocationId: id, deliveredAt: "2026-10-14T10:00:00Z", deliveredWetMassKg: 1, moisturePercent: 20 };
describe("delivery API inputs", () => {
  it("accepts offset and facility-local event instants", () => {
    expect(recordDeliveryInput.parse(input)).toEqual(input);
    expect(recordDeliveryInput.safeParse({ ...input, deliveredAt: { date: "2026-10-14", time: "12:00" } }).success).toBe(true);
    expect(recordDeliveryInput.safeParse({ ...input, deliveredAt: "2026-10-14T12:00:00" }).success).toBe(false);
  });
  it.each([0, 5e-324, 0.0009, 1.0001])("refuses unstorable wet mass %s", deliveredWetMassKg => {
    expect(recordDeliveryInput.safeParse({ ...input, deliveredWetMassKg }).success).toBe(false);
  });
  it("requires moisture unless ordered sources are supplied", () => {
    expect(recordDeliveryInput.safeParse({ ...input, moisturePercent: undefined }).success).toBe(false);
    expect(recordDeliveryInput.safeParse({ ...input, moisturePercent: undefined, sources: [{ layerId: id, moisturePercent: 25 }] }).success).toBe(true);
  });
  it.each(["facilityId", "status", "idempotencyKey", "correctsMovementId", "customerLocationId", "code"])("does not publish %s", field => {
    expect(recordDeliveryInput.safeParse({ ...input, [field]: id }).success).toBe(false);
  });
  it.each(["deliveredWetMassKg", "moisturePercent", "sources", "deliveredAt", "orderId", "storageLocationId"])("PATCH refuses %s", field => {
    expect(updateDeliveryApiInput.safeParse({ expectedVersion: 1, [field]: input.orderId }).success).toBe(false);
  });
  it("keeps absent PATCH fields absent and accepts explicit clears", () => {
    expect(updateDeliveryApiInput.parse({ expectedVersion: 1 })).toEqual({ expectedVersion: 1 });
    expect(updateDeliveryApiInput.parse({ expectedVersion: 1, distanceKmOverride: null }).distanceKmOverride).toBeNull();
    expect(updateDeliveryApiInput.safeParse({ expectedVersion: 1, distanceKmOverride: 0 }).success).toBe(false);
  });
});

it.each([
  [undefined, "Delivered wet mass is required"],
  ["invalid", "Delivered wet mass must be a number"],
  [0, "Delivered wet mass must be greater than 0"],
  [5e-324, "Wet mass must be at least 0.001 kg"],
])("uses delivery mass wording for %s", (deliveredWetMassKg, message) => {
  const result = recordDeliveryInput.safeParse({ ...input, deliveredWetMassKg });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["deliveredWetMassKg"], message }));
});
