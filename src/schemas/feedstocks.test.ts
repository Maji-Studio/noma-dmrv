import { describe, expect, it } from "vitest";
import {
  createFeedstockSchema,
  feedstockFormSchema,
  updateFeedstockSchema,
} from "./feedstocks";

const validForm = {
  facilityId: "00000000-0000-4000-8000-000000000001",
  supplierId: "00000000-0000-4000-8000-000000000002",
  feedstockTypeId: "00000000-0000-4000-8000-000000000003",
  totalWetMassKg: 100,
  moisturePercent: 10,
  allocations: [
    {
      storageLocationId: "00000000-0000-4000-8000-000000000004",
      allocatedWetMassKg: 100,
    },
  ],
};

describe("feedstock delivery-date schemas", () => {
  it("requires a delivery date when editing", () => {
    const result = feedstockFormSchema.safeParse(validForm);

    expect(result.success).toBe(false);
  });

  it("still requires a delivery date when creating a record", () => {
    expect(createFeedstockSchema.safeParse(validForm).success).toBe(false);
    expect(
      createFeedstockSchema.safeParse({
        ...validForm,
        deliveryDate: "2026-07-22",
      }).success,
    ).toBe(true);
  });
});

const patch = { feedstockId: validForm.facilityId, expectedVersion: 1 };
it("refuses clearing the intake bin", () => {
  for (const storageLocationId of [null, ""]) {
    expect(updateFeedstockSchema.safeParse({ ...patch, storageLocationId }).success).toBe(false);
  }
  expect(updateFeedstockSchema.safeParse(patch).success).toBe(true);
});
it("requires moisture below 100 on create and update", () => {
  for (const moisture of [100, 101]) {
    expect(createFeedstockSchema.safeParse({ ...validForm, deliveryDate: "2026-10-15", moisturePercent: moisture }).success).toBe(false);
    expect(updateFeedstockSchema.safeParse({ ...patch, moistureContentPercent: moisture }).success).toBe(false);
  }
  expect(updateFeedstockSchema.safeParse({ ...patch, moistureContentPercent: 99.999999 }).success).toBe(true);
});
it("strips dry mass from the in-process PATCH schema", () => {
  expect(updateFeedstockSchema.parse({ ...patch, massDryKg: 90 })).not.toHaveProperty("massDryKg");
});

it("coerces positive distance overrides and preserves omitted versus cleared patches", () => {
  expect(updateFeedstockSchema.parse(patch).transportDistanceKm).toBeUndefined();
  for (const transportDistanceKm of [null, ""]) {
    expect(updateFeedstockSchema.parse({ ...patch, transportDistanceKm }).transportDistanceKm).toBeNull();
  }
  expect(updateFeedstockSchema.parse({ ...patch, transportDistanceKm: "25.5", distanceNote: "Alternate route" }))
    .toMatchObject({ transportDistanceKm: 25.5, distanceNote: "Alternate route" });
  expect(updateFeedstockSchema.parse({ ...patch, transportDistanceKm: 0 }).transportDistanceKm).toBe(0);
  expect(createFeedstockSchema.parse({ ...validForm, deliveryDate: "2026-10-15", transportDistanceKm: 0 }).transportDistanceKm).toBe(0);
  for (const transportDistanceKm of [-1, Infinity, "invalid"]) {
    expect(updateFeedstockSchema.safeParse({ ...patch, transportDistanceKm }).success).toBe(false);
    expect(createFeedstockSchema.safeParse({ ...validForm, deliveryDate: "2026-10-15", transportDistanceKm }).success).toBe(false);
  }
});
