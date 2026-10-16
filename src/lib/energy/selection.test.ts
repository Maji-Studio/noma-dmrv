import { describe, expect, it } from "vitest";
import {
  batchReachesPeriod,
  creditBatchOptions,
  resolveSelectedBatch,
  totalsBySource,
} from "./selection";
import type { EnergyCreditBatchInput, EnergyFlow, EnergyGap } from "./types";

const JULY: EnergyCreditBatchInput = { id: "jul", code: "CB-JUL", startDate: "2026-07-01", endDate: "2026-07-31", status: "pending" };
const SEPTEMBER: EnergyCreditBatchInput = { id: "sep", code: "CB-SEP", startDate: "2026-09-01", endDate: "2026-09-30", status: "pending" };
const BATCHES = [JULY, SEPTEMBER];
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };
const julyDeliveryInSeptember: EnergyFlow = {
  source: "biocharTransport",
  creditBatchId: "jul",
  day: "2026-09-12",
  activity: 40,
};

describe("resolveSelectedBatch", () => {
  it("resolves a batch outside the period's dates when its energy lands in the period", () => {
    expect(resolveSelectedBatch(BATCHES, PERIOD, [julyDeliveryInSeptember], "jul")).toBe(JULY);
  });

  it("resolves a batch whose dates overlap the period", () => {
    expect(resolveSelectedBatch(BATCHES, PERIOD, [], "sep")).toBe(SEPTEMBER);
  });

  it("drops a batch the period neither overlaps nor reaches, and an unknown id", () => {
    expect(resolveSelectedBatch(BATCHES, PERIOD, [], "jul")).toBeNull();
    expect(resolveSelectedBatch(BATCHES, PERIOD, [julyDeliveryInSeptember], "gone")).toBeNull();
    expect(resolveSelectedBatch(BATCHES, PERIOD, [julyDeliveryInSeptember], null)).toBeNull();
  });
});

describe("creditBatchOptions", () => {
  it("lists the batches overlapping the period", () => {
    expect(creditBatchOptions(BATCHES, PERIOD, [])).toEqual([SEPTEMBER]);
  });

  it("also lists a batch the period's energy reaches, so a later delivery stays selectable", () => {
    expect(creditBatchOptions(BATCHES, PERIOD, [julyDeliveryInSeptember])).toEqual([JULY, SEPTEMBER]);
  });
});

describe("batchReachesPeriod", () => {
  const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

  it("keeps a selection whose activity is still in the next period", () => {
    const delivery = { ...julyDeliveryInSeptember, day: "2026-10-05" };
    expect(batchReachesPeriod(JULY, OCTOBER, [delivery])).toBe(true);
    expect(batchReachesPeriod(JULY, OCTOBER, [])).toBe(false);
    expect(batchReachesPeriod(SEPTEMBER, PERIOD, [])).toBe(true);
  });

  it("ignores flows dated outside the period, such as old-period flows under a narrower period", () => {
    const narrower = { from: "2026-09-20", to: "2026-09-30" };
    expect(batchReachesPeriod(JULY, PERIOD, [julyDeliveryInSeptember])).toBe(true);
    expect(batchReachesPeriod(JULY, narrower, [julyDeliveryInSeptember])).toBe(false);
  });
});

describe("totalsBySource", () => {
  it("marks a source recorded only when a reading reached it, even a zero", () => {
    const zeroGrid: EnergyFlow = { source: "grid", creditBatchId: null, day: "2026-09-02", activity: 0 };
    const missingStartup: EnergyGap = { source: "startup", creditBatchIds: [], day: "2026-09-02", recordId: "run" };
    const totals = totalsBySource([zeroGrid], [missingStartup]);
    expect(totals.grid).toMatchObject({ activity: 0, recorded: true, missingReadings: 0 });
    expect(totals.startup).toMatchObject({ activity: 0, recorded: false, missingReadings: 1 });
  });

  it("adds each source's activity across flows", () => {
    const grid = (activity: number): EnergyFlow => ({ source: "grid", creditBatchId: null, day: "2026-09-02", activity });
    const totals = totalsBySource([grid(10), grid(5), julyDeliveryInSeptember], []);
    expect(totals.grid.activity).toBe(15);
    expect(totals.biocharTransport.activity).toBe(40);
  });
});
