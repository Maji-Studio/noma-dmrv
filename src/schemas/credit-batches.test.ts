import { describe, expect, it } from "vitest";
import { CREDIT_BATCH_NAME_MAX_LENGTH, createCreditBatchSchema, updateCreditBatchSchema } from "./credit-batches";

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

describe("credit batch name", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const base = { facilityId: id, feedstockTypeId: id, startDate: "2026-09-01", endDate: "2026-09-30" };
  const nameOf = (name: unknown) => createCreditBatchSchema.parse({ ...base, name }).name;

  it("is optional on create and update", () => {
    expect(createCreditBatchSchema.parse(base).name).toBeUndefined();
    expect(updateCreditBatchSchema.parse({ creditBatchId: id, expectedVersion: 1 })).not.toHaveProperty("name");
  });

  it("trims the name", () => {
    expect(nameOf("  September maize  ")).toBe("September maize");
  });

  it("turns a blank name into null on create and update", () => {
    expect(nameOf("")).toBeNull();
    expect(nameOf("   ")).toBeNull();
    expect(updateCreditBatchSchema.parse({ creditBatchId: id, expectedVersion: 1, name: "  " }).name).toBeNull();
    expect(updateCreditBatchSchema.parse({ creditBatchId: id, expectedVersion: 1, name: null }).name).toBeNull();
  });

  it("accepts the longest name and rejects one character more", () => {
    expect(nameOf("a".repeat(CREDIT_BATCH_NAME_MAX_LENGTH))).toHaveLength(CREDIT_BATCH_NAME_MAX_LENGTH);
    const tooLong = "a".repeat(CREDIT_BATCH_NAME_MAX_LENGTH + 1);
    expect(createCreditBatchSchema.safeParse({ ...base, name: tooLong }).success).toBe(false);
    expect(updateCreditBatchSchema.safeParse({ creditBatchId: id, expectedVersion: 1, name: tooLong }).success).toBe(false);
  });
});
