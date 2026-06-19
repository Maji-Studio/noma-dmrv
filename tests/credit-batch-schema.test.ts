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

  it("requires at least one production run (the batch's feedstock is derived from membership)", () => {
    const result = creditBatchFormSchema.safeParse({
      ...validBase,
      productionRunIds: [],
      startDate: "2026-05-10",
      endDate: "2026-05-20",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === "productionRunIds",
      );
      expect(issue?.message).toMatch(/at least one production run/i);
    }
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
});
