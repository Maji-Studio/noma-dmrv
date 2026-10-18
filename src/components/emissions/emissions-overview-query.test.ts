import { describe, expect, it } from "vitest";
import type { EmissionLineCounts, FacilityEmissionsOverviewBatch } from "@/hooks/use-emissions-overview";
import {
  emissionsBatchHref,
  emissionsOverviewHref,
  facetBatches,
  filterAndSortBatches,
  periodRange,
  type EmissionsOverviewQuery,
} from "./emissions-overview-query";

const TODAY = "2026-10-16";
const NO_FILTER: EmissionsOverviewQuery = {
  q: "", status: null, period: null, from: null, to: null, sort: "period", dir: "desc",
};

function counts(overrides: Partial<EmissionLineCounts> = {}): EmissionLineCounts {
  return {
    total: 10, open: 0, fileMissing: 0, needsReview: 0, notRecorded: 0,
    needsSetup: 0, recorded: 10, ...overrides,
  };
}

function batch(code: string, startDate: string, endDate: string | null, lineCounts = counts()): FacilityEmissionsOverviewBatch {
  return {
    creditBatchId: `id-${code}`, code, startDate, endDate, status: "pending",
    templateName: "Template", lineCounts, entriesThisMonth: 0, lastEntryOn: null,
  };
}

const BATCHES = [
  batch("CB-2026-07", "2026-07-01", "2026-07-31", counts({ open: 3, fileMissing: 1, notRecorded: 2 })),
  batch("CB-2026-09", "2026-09-01", "2026-09-30", counts({ open: 1, needsReview: 1 })),
  batch("CB-2026-10", "2026-10-01", null, counts({ open: 5, notRecorded: 5 })),
  batch("CB-2025-12", "2025-12-01", "2025-12-31"),
];
const codes = (rows: FacilityEmissionsOverviewBatch[]) => rows.map((row) => row.code);

describe("periodRange", () => {
  it("resolves presets against the current month", () => {
    expect(periodRange({ period: "month", from: null, to: null }, TODAY)).toEqual(["2026-10", "2026-10"]);
    expect(periodRange({ period: "3m", from: null, to: null }, TODAY)).toEqual(["2026-08", "2026-10"]);
    expect(periodRange({ period: "6m", from: null, to: null }, TODAY)).toEqual(["2026-05", "2026-10"]);
    expect(periodRange({ period: "year", from: null, to: null }, TODAY)).toEqual(["2026-01", "2026-10"]);
    expect(periodRange({ period: "custom", from: "2026-02", to: null }, TODAY)).toEqual(["2026-02", null]);
    expect(periodRange({ period: null, from: "2026-02", to: null }, TODAY)).toEqual([null, null]);
  });

  it("resolves presets on the facility's calendar day, across a year boundary", () => {
    // 1 January at the facility while UTC still reads 31 December.
    expect(periodRange({ period: "month", from: null, to: null }, "2027-01-01")).toEqual(["2027-01", "2027-01"]);
    expect(periodRange({ period: "3m", from: null, to: null }, "2027-01-01")).toEqual(["2026-11", "2027-01"]);
    expect(periodRange({ period: "year", from: null, to: null }, "2027-01-01")).toEqual(["2027-01", "2027-01"]);
  });
});

describe("filterAndSortBatches", () => {
  it("sorts by period, newest first, by default", () => {
    expect(codes(filterAndSortBatches(BATCHES, NO_FILTER, TODAY))).toEqual(["CB-2026-10", "CB-2026-09", "CB-2026-07", "CB-2025-12"]);
  });

  it("searches the batch code without case", () => {
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, q: " cb-2026-0 " }, TODAY))).toEqual(["CB-2026-09", "CB-2026-07"]);
  });

  it("keeps batches whose period overlaps the range", () => {
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, period: "3m" }, TODAY))).toEqual(["CB-2026-10", "CB-2026-09"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, period: "custom", from: "2026-07", to: "2026-07" }, TODAY))).toEqual(["CB-2026-07"]);
  });

  it("filters by line state", () => {
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, status: "done" }, TODAY))).toEqual(["CB-2025-12"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, status: "files" }, TODAY))).toEqual(["CB-2026-07"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, status: "review" }, TODAY))).toEqual(["CB-2026-09"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, status: "open" }, TODAY))).toHaveLength(3);
  });

  it("does not count a batch without lines as done", () => {
    const empty = batch("CB-EMPTY", "2026-10-01", null, counts({ total: 0, recorded: 0 }));
    expect(codes(filterAndSortBatches([empty], { ...NO_FILTER, status: "done" }, TODAY))).toEqual([]);
  });

  it("sorts by open lines and by code in either direction", () => {
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, sort: "open", dir: "desc" }, TODAY))).toEqual(["CB-2026-10", "CB-2026-07", "CB-2026-09", "CB-2025-12"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, sort: "code", dir: "asc" }, TODAY))).toEqual(["CB-2025-12", "CB-2026-07", "CB-2026-09", "CB-2026-10"]);
  });

  it("leaves the state filter out of the KPI facet", () => {
    const withState: EmissionsOverviewQuery = { ...NO_FILTER, status: "done" };
    expect(facetBatches(BATCHES, withState, TODAY)).toHaveLength(4);
  });
});

describe("emissions hrefs", () => {
  it("leaves defaults out", () => {
    expect(emissionsOverviewHref()).toBe("/emissions");
    expect(emissionsOverviewHref(NO_FILTER)).toBe("/emissions");
  });

  it("carries the facility, the filter and a non-default sort", () => {
    expect(emissionsOverviewHref({ ...NO_FILTER, facility: "fac", q: "CB", status: "open", sort: "code", dir: "asc" }))
      .toBe("/emissions?facility=fac&q=CB&status=open&sort=code&dir=asc");
  });

  it("keeps a custom range only with the custom preset", () => {
    expect(emissionsOverviewHref({ ...NO_FILTER, period: "3m", from: "2026-01" })).toBe("/emissions?period=3m");
    expect(emissionsOverviewHref({ ...NO_FILTER, period: "custom", from: "2026-01", to: "2026-03" }))
      .toBe("/emissions?period=custom&from=2026-01&to=2026-03");
  });

  it("links a batch with the overview query", () => {
    expect(emissionsBatchHref("abc", { ...NO_FILTER, status: "files" })).toBe("/emissions/abc?status=files");
  });
});
