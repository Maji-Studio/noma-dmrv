import { describe, expect, it } from "vitest";
import { PG_INTEGER_MAX } from "./helpers";
import { sampleFormSchema, updateSampleSchema } from "./samples";

const form = {
  creditBatchId: "00000000-0000-4000-8000-000000000001",
  samplingTime: "2026-09-10T08:00:00Z",
  totalCarbonPercent: 80,
  organicCarbonPercent: 75,
};

describe("Sample form's unresolved durability tier", () => {
  it.each([undefined, null])("keeps an unloaded tier null (%s) without requiring 1,000-year evidence", (durabilityOption) => {
    expect(sampleFormSchema.parse({ ...form, durabilityOption }).durabilityOption).toBeNull();
  });

  it("enforces the existing save requirements once the 1,000-year tier loads", () => {
    const result = sampleFormSchema.safeParse({ ...form, durabilityOption: "1000_year" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ["randomReflectanceR0Percent"], ["residualCarbonPercent"],
    ]);
  });

  it("accepts the nullable form-only tier mirror on an edit", () => {
    expect(updateSampleSchema.parse({
      sampleId: form.creditBatchId, expectedVersion: 1, durabilityOption: null,
    }).durabilityOption).toBeNull();
  });
});

describe("Sample form R₀ measurement count", () => {
  it.each([0, 500, "500", " 500 ", PG_INTEGER_MAX])("accepts a complete integer (%s)", (r0MeasurementCount) => {
    expect(sampleFormSchema.parse({ ...form, r0MeasurementCount }).r0MeasurementCount).toBe(Number(r0MeasurementCount));
  });

  it.each(["", "  ", null])("allows clearing (%s)", (r0MeasurementCount) => {
    expect(sampleFormSchema.parse({ ...form, r0MeasurementCount }).r0MeasurementCount).toBeNull();
  });

  it("allows an omitted count", () => {
    expect(sampleFormSchema.parse(form).r0MeasurementCount).toBeUndefined();
  });

  it.each(["500.9", 500.9, "500abc"])("gives a field message for a non-integer count (%s)", (r0MeasurementCount) => {
    const result = sampleFormSchema.safeParse({ ...form, r0MeasurementCount });
    expect(result.error?.issues).toContainEqual(expect.objectContaining({
      path: ["r0MeasurementCount"], message: "Enter a whole number of readings.",
    }));
  });

  it.each([PG_INTEGER_MAX + 1, String(PG_INTEGER_MAX + 1)])("keeps the existing max message (%s)", (r0MeasurementCount) => {
    const result = sampleFormSchema.safeParse({ ...form, r0MeasurementCount });
    expect(result.error?.issues).toContainEqual(expect.objectContaining({
      path: ["r0MeasurementCount"], message: "Measurement count is too large",
    }));
  });

  it.each(["500.9", 500.9, "500abc", "abc", "Infinity", Infinity, NaN, -1, PG_INTEGER_MAX + 1])(
    "rejects fractional, partial, non-finite or out-of-range input (%s)", (r0MeasurementCount) => {
      const result = sampleFormSchema.safeParse({ ...form, r0MeasurementCount });
      expect(result.success).toBe(false);
      expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ["r0MeasurementCount"] }));
    },
  );
});
