import { describe, expect, it } from "vitest";
import { createGhgStatementSchema } from "./certification";

const FACILITY_ID = "3f2b0b3a-3f0e-4a1c-9d4b-0f1a2b3c4d5e";

function parseEnd(reportingPeriodEndOn: string) {
  return createGhgStatementSchema.safeParse({
    facilityId: FACILITY_ID,
    reportingPeriodEndOn,
  });
}

describe("createGhgStatementSchema.reportingPeriodEndOn", () => {
  it("accepts a real calendar date", () => {
    expect(parseEnd("2028-01-31").success).toBe(true);
  });

  it("rejects a shape that is not YYYY-MM-DD", () => {
    expect(parseEnd("31/01/2028").success).toBe(false);
    expect(parseEnd("").success).toBe(false);
  });

  it("rejects a date that does not exist on the calendar", () => {
    expect(parseEnd("2026-02-31").success).toBe(false);
  });

  it("rejects a half-typed year an <input type=\"date\"> emits mid-keystroke", () => {
    // "0202-01-31" passes the Date.UTC round-trip, so without the settled-entry
    // refine a partial year reaches the create action — and compares as earlier
    // than every existing period end.
    for (const partial of ["0002-01-31", "0020-01-31", "0202-01-31"]) {
      expect(parseEnd(partial).success).toBe(false);
    }
  });
});
