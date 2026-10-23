import { describe, expect, it } from "vitest";
import { buildCreditBatchOpenItems } from "./open-items";
import { overviewBadgeCount, tabBadge } from "./batch-page";

const context = { facilityId: "facility", creditBatchId: "batch", canManage: true };
const run = { id: "run", code: "PR-112", startDate: "2026-09-09" };
const lateProductionRuns = { sentRemovalCodes: ["RM-009"], runs: [run], manualEntryDates: [] as string[] };

describe("late production run Check to-dos", () => {
  it("adds a non-blocking Check with the run, sent Removal, start day and Emissions link", () => {
    const items = buildCreditBatchOpenItems({ ...context, lateProductionRuns });
    expect(items).toEqual({ blocking: [], check: [{
      id: "late-production-run:run",
      title: "PR-112 ran after RM-009 was sent",
      detail: "It is not in this credit batch. Record its diesel and power on the Emissions tab, dated Sep 9, 2026.",
      target: { href: "/credit-batches/batch?facility=facility&tab=emissions" },
    }] });
    expect(overviewBadgeCount({ ...items, waiting: [] })).toBe(1);
    expect(tabBadge("overview", { ...items, waiting: [] })).toEqual({ count: 1, blocking: false });
  });

  it("adds one item per run and joins several sent Removal codes", () => {
    const { check } = buildCreditBatchOpenItems({ ...context, lateProductionRuns: {
      ...lateProductionRuns, sentRemovalCodes: ["RM-009", "RM-010", "RM-011"],
      runs: [run, { id: "second", code: "PR-113", startDate: "2026-09-10" }],
    } });
    expect(check.map(item => item.title)).toEqual([
      "PR-112 ran after RM-009, RM-010 and RM-011 were sent",
      "PR-113 ran after RM-009, RM-010 and RM-011 were sent",
    ]);
    expect(check.map(item => item.id)).toEqual(["late-production-run:run", "late-production-run:second"]);
    expect(check[1].detail).toContain("Sep 10, 2026");
  });

  it("clears every run starting on a day with a manual value entry", () => {
    const items = buildCreditBatchOpenItems({ ...context, lateProductionRuns: {
      ...lateProductionRuns, manualEntryDates: [run.startDate],
      runs: [run, { ...run, id: "same-day", code: "PR-113" }],
    } });
    expect(items).toEqual({ blocking: [], check: [] });
  });

  it("keeps the Check when the entry is on another day", () => {
    const { check } = buildCreditBatchOpenItems({ ...context, lateProductionRuns: {
      ...lateProductionRuns, manualEntryDates: ["2026-09-10"],
    } });
    expect(check.map(item => item.id)).toEqual(["late-production-run:run"]);
  });

  it("does not add an item when the batch has no sent Removal", () => {
    expect(buildCreditBatchOpenItems({ ...context, lateProductionRuns: {
      ...lateProductionRuns, sentRemovalCodes: [],
    } })).toEqual({ blocking: [], check: [] });
    expect(buildCreditBatchOpenItems(context)).toEqual({ blocking: [], check: [] });
  });
});
