import { describe, expect, it } from "vitest";
import {
  describeCreditBatchPreview,
  type ProductionRunCreditBatchPreviewView,
} from "./production-run-credit-batch-preview-copy";

const OCTOBER = { id: "b-oct", code: "CB-26-010-A", startDate: "2026-10-01", endDate: "2026-10-31" };
const SEPTEMBER = { id: "b-sep", code: "CB-26-009-A", startDate: "2026-09-01", endDate: "2026-09-30" };
const END_BASIS = {
  day: "2026-10-02",
  dayBasis: "end" as const,
  facilityName: "Mafinga Facility",
  timeZone: "Africa/Dar_es_Salaam",
  feedstockTypeName: "Forestry waste",
};
const START_BASIS = { ...END_BASIS, day: "2026-09-30", dayBasis: "start" as const };

function line(view: ProductionRunCreditBatchPreviewView) {
  const copy = describeCreditBatchPreview(view);
  return `${copy.lead}${copy.batches.map((batch) => batch.code).join(", ")}${copy.tail}`;
}

const ALL_VIEWS: ProductionRunCreditBatchPreviewView[] = [
  { state: "pending" },
  { state: "error" },
  { state: "not-applicable", status: "cancelled" },
  { state: "incomplete", missing: "facility" },
  { state: "incomplete", missing: "start" },
  { state: "incomplete", missing: "end" },
  { state: "incomplete", missing: "feedstock" },
  { state: "mixed-feedstock", feedstockTypeCount: 2 },
  { state: "member", batch: SEPTEMBER, basis: END_BASIS, conflict: null },
  { state: "member", batch: SEPTEMBER, basis: END_BASIS, conflict: "outside-window" },
  { state: "member", batch: SEPTEMBER, basis: END_BASIS, conflict: "facility" },
  { state: "member", batch: SEPTEMBER, basis: END_BASIS, conflict: "feedstock" },
  { state: "member", batch: SEPTEMBER, basis: null, conflict: "reopen" },
  { state: "match", batch: OCTOBER, basis: END_BASIS, expected: false },
  { state: "match", batch: OCTOBER, basis: END_BASIS, expected: true },
  { state: "match", batch: SEPTEMBER, basis: START_BASIS, expected: true },
  { state: "locked", batch: OCTOBER, basis: END_BASIS, expected: false },
  { state: "ambiguous", batches: [OCTOBER, SEPTEMBER], basis: END_BASIS, expected: false },
  { state: "no-match", basis: END_BASIS, expected: false },
  { state: "no-match", basis: START_BASIS, expected: true },
];

describe("describeCreditBatchPreview", () => {
  it("names a completed run's batch and window, matched on the end day", () => {
    const copy = describeCreditBatchPreview({ state: "match", batch: OCTOBER, basis: END_BASIS, expected: false });
    expect(line({ state: "match", batch: OCTOBER, basis: END_BASIS, expected: false }))
      .toBe("Joins credit batch CB-26-010-A (Oct 1 to Oct 31, 2026)");
    expect(copy.tone).toBe("neutral");
    expect(copy.info).toContain("Matched on the end day, Oct 2, 2026 (Africa/Dar es Salaam), at Mafinga Facility with Forestry waste.");
  });

  it("calls a running run's batch an expectation, never a join", () => {
    expect(line({ state: "match", batch: OCTOBER, basis: END_BASIS, expected: true }))
      .toBe("Expected credit batch: CB-26-010-A (Oct 1 to Oct 31, 2026)");
  });

  it("marks a start-day stand-in as provisional in the line itself", () => {
    const view = { state: "match", batch: SEPTEMBER, basis: START_BASIS, expected: true } as const;
    expect(line(view)).toBe("Expected credit batch: CB-26-009-A (Sep 1 to Sep 30, 2026), by start day");
    expect(describeCreditBatchPreview(view).info).toContain("no end time yet, so its start day stands in");
  });

  it("keeps a failed lookup apart from no match, with Retry", () => {
    const failed = describeCreditBatchPreview({ state: "error" });
    expect(failed.lead).toBe("Credit batch could not be checked.");
    expect(failed.retry).toBe(true);
    expect(line({ state: "no-match", basis: END_BASIS, expected: false })).toBe("No credit batch covers Oct 2, 2026 yet.");
    expect(describeCreditBatchPreview({ state: "no-match", basis: END_BASIS, expected: false }).retry).toBe(false);
  });

  it("names what an incomplete form still needs instead of claiming no match", () => {
    expect(line({ state: "incomplete", missing: "feedstock" })).toBe("Choose a source bin to see the credit batch.");
    expect(line({ state: "incomplete", missing: "end" })).toBe("Enter the end date and time to see the credit batch.");
  });

  it("warns for locked, ambiguous, mixed feedstock and refused member edits", () => {
    expect(describeCreditBatchPreview({ state: "locked", batch: OCTOBER, basis: END_BASIS, expected: false }).tone).toBe("warning");
    expect(line({ state: "ambiguous", batches: [OCTOBER, SEPTEMBER], basis: END_BASIS, expected: false }))
      .toBe("More than one credit batch covers Oct 2, 2026: CB-26-010-A, CB-26-009-A.");
    expect(line({ state: "mixed-feedstock", feedstockTypeCount: 2 }))
      .toBe("No credit batch: the source bins hold 2 feedstock types.");
    expect(line({ state: "member", batch: SEPTEMBER, basis: END_BASIS, conflict: "outside-window" }))
      .toBe("In credit batch CB-26-009-A (Sep 1 to Sep 30, 2026). This end day is outside it, so the save is refused.");
  });

  it("says pending while checking, with no batch", () => {
    const copy = describeCreditBatchPreview({ state: "pending" });
    expect(copy.busy).toBe(true);
    expect(copy.batches).toHaveLength(0);
  });

  it.each(ALL_VIEWS)("$state copy has no dash, no 'on save' and no 'What happens next'", (view) => {
    const copy = describeCreditBatchPreview(view);
    const text = `${line(view)} ${copy.info ?? ""}`;
    expect(text).not.toMatch(/[–—]/);
    expect(text.toLowerCase()).not.toContain("on save");
    expect(text).not.toContain("What happens next");
  });
});
