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

const NOW = new Date("2026-10-16T12:00:00Z");
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
    expect(periodRange({ period: "month", from: null, to: null }, NOW)).toEqual(["2026-10", "2026-10"]);
    expect(periodRange({ period: "3m", from: null, to: null }, NOW)).toEqual(["2026-08", "2026-10"]);
    expect(periodRange({ period: "6m", from: null, to: null }, NOW)).toEqual(["2026-05", "2026-10"]);
    expect(periodRange({ period: "year", from: null, to: null }, NOW)).toEqual(["2026-01", "2026-10"]);
    expect(periodRange({ period: "custom", from: "2026-02", to: null }, NOW)).toEqual(["2026-02", null]);
    expect(periodRange({ period: null, from: "2026-02", to: null }, NOW)).toEqual([null, null]);
  });
});

describe("filterAndSortBatches", () => {
  it("sorts by period, newest first, by default", () => {
    expect(codes(filterAndSortBatches(BATCHES, NO_FILTER, NOW))).toEqual(["CB-2026-10", "CB-2026-09", "CB-2026-07", "CB-2025-12"]);
  });

  it("searches the batch code without case", () => {
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, q: " cb-2026-0 " }, NOW))).toEqual(["CB-2026-09", "CB-2026-07"]);
  });

  it("keeps batches whose period overlaps the range", () => {
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, period: "3m" }, NOW))).toEqual(["CB-2026-10", "CB-2026-09"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, period: "custom", from: "2026-07", to: "2026-07" }, NOW))).toEqual(["CB-2026-07"]);
  });

  it("filters by line state", () => {
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, status: "done" }, NOW))).toEqual(["CB-2025-12"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, status: "files" }, NOW))).toEqual(["CB-2026-07"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, status: "review" }, NOW))).toEqual(["CB-2026-09"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, status: "open" }, NOW))).toHaveLength(3);
  });

  it("does not count a batch without lines as done", () => {
    const empty = batch("CB-EMPTY", "2026-10-01", null, counts({ total: 0, recorded: 0 }));
    expect(codes(filterAndSortBatches([empty], { ...NO_FILTER, status: "done" }, NOW))).toEqual([]);
  });

  it("sorts by open lines and by code in either direction", () => {
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, sort: "open", dir: "desc" }, NOW))).toEqual(["CB-2026-10", "CB-2026-07", "CB-2026-09", "CB-2025-12"]);
    expect(codes(filterAndSortBatches(BATCHES, { ...NO_FILTER, sort: "code", dir: "asc" }, NOW))).toEqual(["CB-2025-12", "CB-2026-07", "CB-2026-09", "CB-2026-10"]);
  });

  it("leaves the state filter out of the KPI facet", () => {
    const withState: EmissionsOverviewQuery = { ...NO_FILTER, status: "done" };
    expect(facetBatches(BATCHES, withState, NOW)).toHaveLength(4);
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
