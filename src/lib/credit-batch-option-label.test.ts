import { describe, expect, it } from "vitest";
import { creditBatchOptionLabel } from "./credit-batch-option-label";

describe("creditBatchOptionLabel", () => {
  it("names the credit batch by code before its production window", () => {
    // Regression: the credit batch filters showed only "Feb 1 to Feb 28, 2026",
    // which read as a date filter on lists whose rows were dated October.
    expect(
      creditBatchOptionLabel({ code: "CB-26-001", startDate: "2026-02-01", endDate: "2026-02-28" }),
    ).toBe("CB-26-001 · Feb 1 to Feb 28, 2026");
  });

  it("keeps the year on both ends for a window that crosses years", () => {
    expect(
      creditBatchOptionLabel({ code: "CB-26-009", startDate: "2026-12-15", endDate: "2027-01-10" }),
    ).toBe("CB-26-009 · Dec 15, 2026 to Jan 10, 2027");
  });
});
