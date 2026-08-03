/**
 * Credit Batch Form Schema Tests (pure — no database)
 *
 * Covers the ADR 0016 ≤1-month production-batch window enforced by the form's
 * superRefine. This form only creates Isometric credit batches, so the cap
 * applies unconditionally here (the certifier-conditional nuance lives at the
 * server + DB layers).
 */
import { describe, expect, it } from "vitest";
import {
  getCreditBatchProductionWindowBounds,
  getCreditBatchProductionWindowIssue,
} from "@/lib/credit-batch-production-window";
import { creditBatchFormSchema } from "@/schemas/credit-batches";

const validBase = {
  facilityId: "11111111-1111-4111-8111-111111111111",
  // Declared up front (ADR 0016 amendment) and required by the form schema.
  feedstockTypeId: "33333333-3333-4333-8333-333333333333",
  productionRunIds: ["22222222-2222-4222-8222-222222222222"],
  durabilityOption: "200_year" as const,
  hToCorgRatio: 0.4,
};

describe("creditBatchFormSchema — production window", () => {
  it("accepts a window under one month", () => {
    const result = creditBatchFormSchema.safeParse({
      ...validBase,
      startDate: "2026-05-10",
      endDate: "2026-06-05",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a window longer than one month", () => {
    const result = creditBatchFormSchema.safeParse({
      ...validBase,
      startDate: "2026-05-10",
      endDate: "2026-07-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "endDate");
      expect(issue?.message).toMatch(/at most one month/i);
    }
  });

  it("rejects an end date before the start date", () => {
    const result = creditBatchFormSchema.safeParse({
      ...validBase,
      startDate: "2026-05-10",
      endDate: "2026-05-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "endDate");
      expect(issue?.message).toMatch(/after start date/i);
    }
  });

  it("allows creating a batch before any production runs exist", () => {
    const result = creditBatchFormSchema.safeParse({
      ...validBase,
      productionRunIds: [],
      startDate: "2026-05-10",
      endDate: "2026-05-20",
    });
    expect(result.success).toBe(true);
  });
});

describe("credit batch production window helper", () => {
  it("normalizes non-padded date strings before comparing and returning bounds", () => {
    expect(getCreditBatchProductionWindowIssue("2026-6-2", "2026-6-10")).toBeNull();
    expect(getCreditBatchProductionWindowBounds("2026-6-2", "2026-6-10")).toEqual({
      startStr: "2026-06-02",
      endStr: "2026-06-10",
    });
  });

  it("rejects impossible date-only strings instead of normalizing them", () => {
    expect(getCreditBatchProductionWindowIssue("2026-02-30", "2026-03-01")).toBe(
      "Enter a valid date.",
    );
    expect(() =>
      getCreditBatchProductionWindowBounds("2026-02-30", "2026-03-01"),
    ).toThrow("Enter a valid date.");
  });
});
