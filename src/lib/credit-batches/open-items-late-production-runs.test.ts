import { describe, expect, it } from "vitest";
import { renderedOpenItems } from "../../../tests/helpers/rendered-open-items";
import { buildCreditBatchOpenItems as buildItems } from "./open-items";

const buildCreditBatchOpenItems: typeof buildItems = (input) => renderedOpenItems(buildItems(input));
import { overviewBadgeCount, tabBadge } from "./batch-page";

const context = { facilityId: "facility", creditBatchId: "batch", canManage: true };
const BEFORE_RUN = new Date("2026-10-01T08:00:00Z");
const RUN_CREATED_AT = new Date("2026-10-01T09:00:00Z");
const AFTER_RUN = new Date("2026-10-01T10:00:00Z");
const run = { id: "run", code: "PR-112", startDate: "2026-09-09", createdAt: RUN_CREATED_AT, heldByRemovalCode: null };
const missingProductionRuns = { sentRemovalCodes: ["RM-009"], heldRemovalCodes: [], batchStartDate: "2026-09-01", runs: [run], manualEntries: [] as { occurredOn: string; createdAt: Date }[] };

describe("late production run Check to-dos", () => {
  it("adds a non-blocking Check with the run, sent Removal, start day and Emissions link", () => {
    const items = buildCreditBatchOpenItems({ ...context, missingProductionRuns });
    expect(items).toEqual({ blocking: [], check: [{
      id: "late-production-run:run",
      productionRun: { id: "run", code: "PR-112" },
      title: "PR-112 was recorded after RM-009 was sent",
      titleAfterCode: " was recorded after RM-009 was sent",
      detail: "It is not in this credit batch. Record its diesel and power on the Emissions tab, dated Sep 9, 2026.",
      target: { tab: "emissions" },
    }] });
    expect(overviewBadgeCount({ ...items, waiting: [] })).toBe(1);
    expect(tabBadge("overview", { ...items, waiting: [] })).toEqual({ count: 1, blocking: false });
  });

  it("adds one item per run and joins several sent Removal codes", () => {
    const { check } = buildCreditBatchOpenItems({ ...context, missingProductionRuns: {
      ...missingProductionRuns, sentRemovalCodes: ["RM-009", "RM-010", "RM-011"],
      runs: [run, { ...run, id: "second", code: "PR-113", startDate: "2026-09-10" }],
    } });
    expect(check.map(item => item.title)).toEqual([
      "PR-112 was recorded after RM-009, RM-010 and RM-011 were sent",
      "PR-113 was recorded after RM-009, RM-010 and RM-011 were sent",
    ]);
    expect(check.map(item => item.id)).toEqual(["late-production-run:run", "late-production-run:second"]);
    expect(check.map(item => item.titleAfterCode)).toEqual([
      " was recorded after RM-009, RM-010 and RM-011 were sent",
      " was recorded after RM-009, RM-010 and RM-011 were sent",
    ]);
    expect(check[1].detail).toContain("Sep 10, 2026");
  });

  it("clears runs on the entry day that were created before the entry", () => {
    const items = buildCreditBatchOpenItems({ ...context, missingProductionRuns: {
      ...missingProductionRuns, manualEntries: [{ occurredOn: run.startDate, createdAt: AFTER_RUN }],
      runs: [run, { ...run, id: "same-day", code: "PR-113" }],
    } });
    expect(items).toEqual({ blocking: [], check: [] });
  });

  it.each([BEFORE_RUN, RUN_CREATED_AT])("keeps the Check for a same-day entry created at %s", createdAt => {
    const { check } = buildCreditBatchOpenItems({ ...context, missingProductionRuns: {
      ...missingProductionRuns, manualEntries: [{ occurredOn: run.startDate, createdAt }],
    } });
    expect(check.map(item => item.id)).toEqual(["late-production-run:run"]);
  });

  it("compares creation times separately for runs sharing the to-do date", () => {
    const { check } = buildCreditBatchOpenItems({ ...context, missingProductionRuns: {
      ...missingProductionRuns,
      runs: [run, { ...run, id: "later", createdAt: AFTER_RUN }],
      manualEntries: [{ occurredOn: run.startDate, createdAt: AFTER_RUN }],
    } });
    expect(check.map(item => item.id)).toEqual(["late-production-run:later"]);
  });

  it("keeps the Check when the entry is on another day", () => {
    const { check } = buildCreditBatchOpenItems({ ...context, missingProductionRuns: {
      ...missingProductionRuns, manualEntries: [{ occurredOn: "2026-09-10", createdAt: AFTER_RUN }],
    } });
    expect(check.map(item => item.id)).toEqual(["late-production-run:run"]);
  });

  it("dates a run that started before the batch on the batch start and clears on that day", () => {
    const early = { ...run, id: "early", code: "PR-100", startDate: "2026-08-31" };
    const { check } = buildCreditBatchOpenItems({ ...context, missingProductionRuns: { ...missingProductionRuns, runs: [early] } });
    expect(check[0].detail).toContain("dated Sep 1, 2026.");
    expect(buildCreditBatchOpenItems({ ...context, missingProductionRuns: {
      ...missingProductionRuns, runs: [early], manualEntries: [{ occurredOn: "2026-09-01", createdAt: AFTER_RUN }],
    } }).check).toEqual([]);
    expect(buildCreditBatchOpenItems({ ...context, missingProductionRuns: {
      ...missingProductionRuns, runs: [early], manualEntries: [{ occurredOn: "2026-08-31", createdAt: AFTER_RUN }],
    } }).check).toHaveLength(1);
  });

  it("does not add an item when the batch has no sent Removal", () => {
    expect(buildCreditBatchOpenItems({ ...context, missingProductionRuns: {
      ...missingProductionRuns, sentRemovalCodes: [],
    } })).toEqual({ blocking: [], check: [] });
    expect(buildCreditBatchOpenItems(context)).toEqual({ blocking: [], check: [] });
  });

  it("keeps the fact in detail and the next step in instruction", () => {
    const { check } = buildItems({ ...context, missingProductionRuns });
    expect(check[0].detail).toBe("It is not in this credit batch.");
    expect(check[0].instruction).toBe("Record its diesel and power on the Emissions tab, dated Sep 9, 2026.");
  });
});
