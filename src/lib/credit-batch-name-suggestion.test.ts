import { describe, expect, it } from "vitest";
import { CREDIT_BATCH_NAME_MAX_LENGTH } from "@/schemas/credit-batches";
import { nextCreditBatchName } from "./credit-batch-name-suggestion";

describe("nextCreditBatchName", () => {
  it.each([
    ["CB-26-001", "CB-26-002"],
    ["CB-26-009", "CB-26-010"],
    ["Mafinga lot 07", "Mafinga lot 08"],
    ["Lot 99", "Lot 100"],
    ["B-0", "B-1"],
    ["Lot 000", "Lot 001"],
    ["007", "008"],
    ["Lot 07 \t\n", "Lot 08"],
    ["  Lot 07", "  Lot 08"],
    ["Lot 9007199254740992", "Lot 9007199254740993"],
  ])("increments %j to %j", (previous, expected) => {
    expect(nextCreditBatchName(previous)).toBe(expected);
  });

  it.each([null, undefined, "", " \t\n", "Lot", "Lot 07 done", "Lot 07 done \t"])(
    "returns null for %j without a trailing number",
    (previous) => {
      expect(nextCreditBatchName(previous)).toBeNull();
    },
  );

  it("accepts a suggestion at the name length limit", () => {
    const prefix = "x".repeat(CREDIT_BATCH_NAME_MAX_LENGTH - 1);
    expect(nextCreditBatchName(`${prefix}8`)).toBe(`${prefix}9`);
  });

  it("returns null when incrementing would exceed the name length limit", () => {
    const prefix = "x".repeat(CREDIT_BATCH_NAME_MAX_LENGTH - 1);
    expect(nextCreditBatchName(`${prefix}9`)).toBeNull();
    expect(nextCreditBatchName("9".repeat(CREDIT_BATCH_NAME_MAX_LENGTH))).toBeNull();
  });

  it("returns null for an already overlong suggestion", () => {
    expect(nextCreditBatchName(`${"x".repeat(CREDIT_BATCH_NAME_MAX_LENGTH)}1`)).toBeNull();
  });
});
