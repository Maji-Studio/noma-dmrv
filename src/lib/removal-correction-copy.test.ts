import { describe, expect, it } from "vitest";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import {
  changedComponentNames,
  correctionStatementHref,
  correctionStatementLabel,
  correctionStatus,
  joinWithAnd,
  removalResubmitHref,
  removalSheetHref,
  returnedStatementPhrase,
} from "./removal-correction-copy";

const correction = (overrides: Partial<RemovalCorrection> = {}): RemovalCorrection => ({
  removalId: "removal-1", removalCode: "RM-26-001", windowOpen: true, resubmitNeeded: false,
  statement: { id: "statement-1", status: "FAILED_VERIFICATION", reportingPeriodStartOn: "2026-07-01", reportingPeriodEndOn: "2026-09-30" },
  batches: [{ id: "batch-1", code: "CB-26-001" }], changed: [], ...overrides,
});

describe("removal correction copy", () => {
  it("names the status by whether a sent fact changed", () => {
    expect(correctionStatus(correction())).toEqual({ value: "pending", label: "Returned" });
    expect(correctionStatus(correction({ resubmitNeeded: true }))).toEqual({ value: "pending", label: "Resubmit needed" });
  });

  it("words the statement from its period, or its end alone before the start is known", () => {
    expect(correctionStatementLabel(correction().statement)).toBe("GHG Statement Jul 1 to Sep 30, 2026");
    expect(correctionStatementLabel({ ...correction().statement, reportingPeriodStartOn: null })).toBe("GHG Statement ending Sep 30, 2026");
  });

  it("says what Isometric did with the statement", () => {
    expect(returnedStatementPhrase("FAILED_VERIFICATION")).toBe("failed verification");
    expect(returnedStatementPhrase("DRAFT")).toBe("is back in draft");
  });

  it("lists each changed component once, in the server's order", () => {
    const changed = ["Diesel use", "Transport", "Diesel use"].map((componentName, index) => ({
      componentId: `c${index}`, componentName, batchId: "batch-1", batchCode: "CB-26-001",
    }));
    expect(changedComponentNames(correction({ changed }))).toEqual(["Diesel use", "Transport"]);
  });

  it.each([[[], ""], [["A"], "A"], [["A", "B"], "A and B"], [["A", "B", "C"], "A, B and C"]])("joins %j as %j", (items, text) => {
    expect(joinWithAnd(items)).toBe(text);
  });

  it("links through the shared deep link helpers", () => {
    expect(correctionStatementHref(correction(), "facility-1")).toBe("/certification/ghg-statements?facility=facility-1&statement=statement-1");
    expect(removalSheetHref("removal-1", "facility-1")).toBe("/certification/removals?facility=facility-1&removal=removal-1");
    expect(removalResubmitHref("removal-1", "facility-1")).toBe("/certification/removals?facility=facility-1&resume=removal-1");
  });
});
