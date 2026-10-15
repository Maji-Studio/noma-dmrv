import { describe, expect, it } from "vitest";
import { createCreditBatchSchema, updateCreditBatchSchema } from "./credit-batches";

describe("updateCreditBatchSchema sampling immutability", () => {
  it("rejects an attempt to change sampling after creation", () => {
    const result = updateCreditBatchSchema.safeParse({ expectedVersion: 1,
      creditBatchId: "00000000-0000-0000-0000-000000000101",
      sampling: "unsampled",
    });
    expect(result.success).toBe(false);
  });
});

describe("credit batch schemas unknown keys", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const removedFields = {
    value: 500, currency: "KES", affidavitReference: "legacy", intendedUseConfirmation: "legacy",
    companyVerificationRef: "legacy", mixingTimelineDays: 14,
  };

  it("strips removed price and third-party sale keys like other unknown app input keys", () => {
    const created = createCreditBatchSchema.parse({
      facilityId: id, feedstockTypeId: id, startDate: "2026-09-01", endDate: "2026-09-30",
      ...removedFields, unknownField: "ignored",
    });
    const updated = updateCreditBatchSchema.parse({
      creditBatchId: id, expectedVersion: 1, ...removedFields, unknownField: "ignored",
    });
    for (const parsed of [created, updated]) {
      for (const field of [...Object.keys(removedFields), "unknownField"]) expect(parsed).not.toHaveProperty(field);
    }
    expect(updated).toEqual({ creditBatchId: id, expectedVersion: 1 });
  });
});
