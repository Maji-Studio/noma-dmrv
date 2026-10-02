import { describe, expect, it } from "vitest";
import { creditBatchInPeriod, dayInPeriod, energyPresetPeriod } from "./period";

describe("energyPresetPeriod", () => {
  const today = "2026-10-01";

  it("counts day ranges inclusive of today", () => {
    expect(energyPresetPeriod("30d", today)).toEqual({ from: "2026-09-02", to: today });
    expect(energyPresetPeriod("90d", today)).toEqual({ from: "2026-07-04", to: today });
  });

  it("starts the last 12 months on the first of the month eleven months back", () => {
    expect(energyPresetPeriod("12m", today)).toEqual({ from: "2025-11-01", to: today });
    expect(energyPresetPeriod("12m", "2026-12-31")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("covers this year and all time", () => {
    expect(energyPresetPeriod("ytd", today)).toEqual({ from: "2026-01-01", to: today });
    expect(energyPresetPeriod("all", today)).toEqual({ from: null, to: today });
  });
});

describe("period membership", () => {
  const period = { from: "2026-09-01", to: "2026-09-30" };

  it("includes both ends", () => {
    expect(dayInPeriod("2026-09-01", period)).toBe(true);
    expect(dayInPeriod("2026-09-30", period)).toBe(true);
    expect(dayInPeriod("2026-10-01", period)).toBe(false);
  });

  it("counts a credit batch whose dates overlap the period", () => {
    expect(creditBatchInPeriod({ startDate: "2026-08-15", endDate: "2026-09-02" }, period)).toBe(true);
    expect(creditBatchInPeriod({ startDate: "2026-08-01", endDate: "2026-08-31" }, period)).toBe(false);
    expect(creditBatchInPeriod({ startDate: "2020-01-01", endDate: "2020-01-31" }, { from: null, to: "2026-09-30" })).toBe(true);
  });
});
