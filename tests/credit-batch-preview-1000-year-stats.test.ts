import { describe, expect, it } from "vitest";
import { derive1000YearPreviewStats } from "@/data-access/credit-batch-previews";

describe("derive1000YearPreviewStats", () => {
  it("derives sample means and sample standard deviations from batch replicates", () => {
    const stats = derive1000YearPreviewStats([
      { randomReflectanceR0Percent: 2.4, reactiveCarbonPercent: null, residualCarbonPercent: 80 },
      { randomReflectanceR0Percent: 2.5, reactiveCarbonPercent: null, residualCarbonPercent: 82 },
      { randomReflectanceR0Percent: 2.3, reactiveCarbonPercent: null, residualCarbonPercent: 78 },
    ]);

    expect(stats).toEqual({
      meanRandomReflectancePercent: 2.4,
      stdRandomReflectance: expect.any(Number),
      meanNonReactiveCarbonPercent: 80,
      stdNonReactiveCarbonPercent: 2,
    });
    expect(stats).not.toBeNull();
    if (!stats) return;
    expect(stats.stdRandomReflectance).toBeCloseTo(0.1, 10);
  });

  it("fails closed atomically when fewer than three paired replicates exist", () => {
    expect(
      derive1000YearPreviewStats([
        { randomReflectanceR0Percent: 2.4, reactiveCarbonPercent: null, residualCarbonPercent: null },
      ]),
    ).toEqual({
      meanRandomReflectancePercent: null,
      stdRandomReflectance: null,
      meanNonReactiveCarbonPercent: null,
      stdNonReactiveCarbonPercent: null,
    });
  });

  it("derives non-reactive carbon from accepted reactive-carbon replicates", () => {
    expect(
      derive1000YearPreviewStats([
        { randomReflectanceR0Percent: 2.4, reactiveCarbonPercent: 20, residualCarbonPercent: null },
        { randomReflectanceR0Percent: 2.5, reactiveCarbonPercent: 18, residualCarbonPercent: null },
        { randomReflectanceR0Percent: 2.3, reactiveCarbonPercent: 22, residualCarbonPercent: null },
      ]),
    ).toMatchObject({
      meanNonReactiveCarbonPercent: 80,
      stdNonReactiveCarbonPercent: 2,
    });
  });

  it("returns null when samples contain no 1000-year preview evidence", () => {
    expect(
      derive1000YearPreviewStats([
        { randomReflectanceR0Percent: null, reactiveCarbonPercent: null, residualCarbonPercent: null },
      ]),
    ).toBeNull();
  });
});
