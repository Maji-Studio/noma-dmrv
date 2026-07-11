import { describe, expect, it } from "vitest";
import { createSampleSchema } from "@/schemas/samples";

const thousandYearSample = {
  creditBatchId: "00000000-0000-4000-8000-000000000001",
  samplingTime: new Date("2026-01-10T10:00:00.000Z"),
  totalCarbonPercent: 82,
  organicCarbonPercent: 80,
  durabilityOption: "1000_year" as const,
  randomReflectanceR0Percent: 2.8,
  residualCarbonPercent: 65,
};

describe("1000-year Sample input", () => {
  it("requires the per-sample fraction of R₀ readings at or above 2%", () => {
    const result = createSampleSchema.safeParse(thousandYearSample);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path:["sReflectanceFraction"], message:expect.stringMatching(/R₀ readings.*2%/) }),
    ]));
  });

  it("accepts a 0–1 s_fraction and rejects values outside that range", () => {
    expect(createSampleSchema.safeParse({ ...thousandYearSample, sReflectanceFraction:0.92 }).success).toBe(true);
    expect(createSampleSchema.safeParse({ ...thousandYearSample, sReflectanceFraction:1.01 }).success).toBe(false);
  });
});
