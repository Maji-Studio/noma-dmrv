import { describe, expect, it } from "vitest";
import { getCreditBatchProductionWindowIssue, isCreditBatchUnderOneMonth } from "./credit-batch-production-window";
import { creditBatchFormSchemaForCertifier } from "@/schemas/credit-batches";
import { assertCreditBatchProductionWindow } from "@/data-access/credit-batch-production-window";

const form = {
  facilityId: "11111111-1111-4111-8111-111111111111",
  feedstockTypeId: "33333333-3333-4333-8333-333333333333",
  durabilityOption: "200_year",
  productionRunIds: [],
};

describe("strict Isometric calendar month", () => {
  it.each([
    ["2026-01-01", "2026-01-31", true],
    ["2026-01-01", "2026-02-01", false],
    ["2026-02-15", "2026-03-14", true],
    ["2026-02-15", "2026-03-15", false],
    ["2026-01-31", "2026-02-27", true],
    ["2026-01-31", "2026-02-28", false],
    ["2024-01-31", "2024-02-28", true],
    ["2024-01-31", "2024-02-29", false],
    ["2026-03-01", "2026-04-01", false],
  ])("agrees in helper, form and server for %s to %s", (startDate, endDate, valid) => {
    expect(getCreditBatchProductionWindowIssue(startDate, endDate) === null).toBe(valid);
    expect(creditBatchFormSchemaForCertifier("isometric").safeParse({ ...form, startDate, endDate }).success).toBe(valid);
    const validate = () => assertCreditBatchProductionWindow(startDate, endDate, "isometric");
    if (valid) expect(validate).not.toThrow();
    else expect(validate).toThrow(/less than one month/);
  });

  it("states the last allowed date after clamping", () => {
    expect(getCreditBatchProductionWindowIssue("2024-01-31", "2024-02-29"))
      .toBe("Choose an end date on or before Feb 28, 2024. Isometric credit batches must cover less than one month.");
  });

  it("preserves instants for member-run spans", () => {
    const start = new Date("2024-01-31T07:15:00Z");
    expect(isCreditBatchUnderOneMonth(start, new Date("2024-02-29T07:14:59.999Z"))).toBe(true);
    expect(isCreditBatchUnderOneMonth(start, new Date("2024-02-29T07:15:00Z"))).toBe(false);
  });
});
