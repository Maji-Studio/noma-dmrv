import { describe, expect, it } from "vitest";
import { creditBatchOptions, resolveSelectedBatch } from "./selection";
import type { EnergyCreditBatchInput, EnergyFlow } from "./types";

const JULY: EnergyCreditBatchInput = { id: "jul", code: "CB-JUL", startDate: "2026-07-01", endDate: "2026-07-31", status: "pending" };
const SEPTEMBER: EnergyCreditBatchInput = { id: "sep", code: "CB-SEP", startDate: "2026-09-01", endDate: "2026-09-30", status: "pending" };
const BATCHES = [JULY, SEPTEMBER];
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };
const julyDeliveryInSeptember: EnergyFlow = {
  source: "biocharTransport",
  creditBatchId: "jul",
  day: "2026-09-12",
  activity: 40,
  kg: 4,
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
    expect(creditBatchOptions(BATCHES, PERIOD, null)).toEqual([SEPTEMBER]);
  });

  it("adds the selected batch when it is outside the overlap", () => {
    expect(creditBatchOptions(BATCHES, PERIOD, JULY)).toEqual([SEPTEMBER, JULY]);
    expect(creditBatchOptions(BATCHES, PERIOD, SEPTEMBER)).toEqual([SEPTEMBER]);
  });
});
