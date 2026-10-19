import { describe, expect, it } from "vitest";
import { formatCreditBatchEntryDateConflict } from "./credit-batch-entry-dates";

describe("formatCreditBatchEntryDateConflict", () => {
  it("names one entry and explains how to clear the refusal", () => {
    expect(formatCreditBatchEntryDateConflict("CB-001", [
      { displayName: "Lab electricity", occurredOn: "2026-06-13" },
    ])).toBe("Credit batch CB-001 was not changed. 1 manual entry falls outside the new dates: Lab electricity, 2026-06-13. Change or delete it on the Emissions page first.");
  });

  it("lists each entry, including repeated line names with different dates", () => {
    expect(formatCreditBatchEntryDateConflict("CB-001", [
      { displayName: "Lab electricity", occurredOn: "2026-06-13" },
      { displayName: "Lab electricity", occurredOn: "2026-06-14" },
    ])).toBe("Credit batch CB-001 was not changed. 2 manual entries fall outside the new dates: Lab electricity, 2026-06-13; Lab electricity, 2026-06-14. Change or delete them on the Emissions page first.");
  });

  it("lists at most five entries and counts the rest", () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({
      displayName: `Line ${index + 1}`, occurredOn: "2026-06-13",
    }));
    const message = formatCreditBatchEntryDateConflict("CB-001", entries);
    expect(message).toContain("7 manual entries fall outside");
    expect(message).toContain("Line 5, 2026-06-13; and 2 more.");
    expect(message).not.toContain("Line 6");
    expect(message).not.toMatch(/[\u2013\u2014]/);
    expect(formatCreditBatchEntryDateConflict("CB-001", entries.slice(0, 5))).not.toContain("more");
  });
});
