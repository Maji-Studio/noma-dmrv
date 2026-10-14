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
  it.each([undefined, null])("allows saving without s_fraction (%s), which is required at certification", (sReflectanceFraction) => {
    expect(createSampleSchema.safeParse({ ...thousandYearSample, sReflectanceFraction }).success).toBe(true);
  });

  it("accepts a 0–1 s_fraction and rejects values outside that range", () => {
    expect(createSampleSchema.safeParse({ ...thousandYearSample, sReflectanceFraction:0.92 }).success).toBe(true);
    expect(createSampleSchema.safeParse({ ...thousandYearSample, sReflectanceFraction:1.01 }).success).toBe(false);
  });

  it.each(["randomReflectanceR0Percent", "residualCarbonPercent"])("keeps the save requirement for %s", (field) => {
    const result = createSampleSchema.safeParse({ ...thousandYearSample, [field]: null });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: [field] }));
  });
});
