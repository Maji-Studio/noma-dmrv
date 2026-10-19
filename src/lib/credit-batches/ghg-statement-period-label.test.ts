import { describe, expect, it } from "vitest";
import { ghgStatementPeriodLabel } from "./ghg-statement-period-label";

describe("ghgStatementPeriodLabel", () => {
  it("shows an end-only period", () => {
    expect(ghgStatementPeriodLabel({
      reportingPeriodStartOn: null,
      reportingPeriodEndOn: "2026-06-30",
      hasMissingPeriod: false,
    })).toBe("Ends Jun 30, 2026");
  });

  it.each([
    ["2026-01-01", "Jan 1 to Jun 30, 2026"],
    ["2025-12-01", "Dec 1, 2025 to Jun 30, 2026"],
  ])("formats a range starting %s", (reportingPeriodStartOn, expected) => {
    expect(ghgStatementPeriodLabel({
      reportingPeriodStartOn,
      reportingPeriodEndOn: "2026-06-30",
      hasMissingPeriod: false,
    })).toBe(expected);
  });

  it.each([null, "2026-01-01"])("prioritizes a missing period over a stored start of %s", reportingPeriodStartOn => {
    expect(ghgStatementPeriodLabel({
      reportingPeriodStartOn,
      reportingPeriodEndOn: "2026-06-30",
      hasMissingPeriod: true,
    })).toBe("No period set");
  });
});
