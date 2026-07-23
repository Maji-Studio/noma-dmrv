import { describe, expect, it } from "vitest";
import {
  createFeedstockSchema,
  feedstockFormSchema,
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
  it("allows an unset date when editing a legacy record", () => {
    const result = feedstockFormSchema.safeParse(validForm);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deliveryDate).toBeUndefined();
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
