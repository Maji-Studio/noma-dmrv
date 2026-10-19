import { describe, expect, it } from "vitest";
import { sampleFormSchema, updateSampleSchema } from "./samples";
const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const form = { creditBatchId: ID, samplingTime: new Date("2026-01-01T12:00:00Z"), totalCarbonPercent: 80, organicCarbonPercent: 75, inorganicCarbonPercent: 5, durabilityOption: "200_year" };
describe.each(["analysisDate", "r0AnalysisDate", "tgaAnalysisDate"] as const)("%s calendar dates", field => {
  for (const [label, schema, base] of [["form", sampleFormSchema, form], ["update", updateSampleSchema, { sampleId: ID, expectedVersion: 1 }]] as const) {
    it(`${label} refuses impossible days and offset timestamps`, () => {
      for (const value of ["2026-02-31", "2025-02-29", "2026-02-01T00:00:00+03:00"]) {
        expect(schema.safeParse({ ...base, [field]: value }).success).toBe(false);
      }
    });
    it(`${label} preserves optional, nullable and empty form inputs`, () => {
      expect(schema.parse(base)[field]).toBeUndefined();
      for (const value of ["", null]) expect(schema.parse({ ...base, [field]: value })[field]).toBeNull();
      expect(schema.parse({ ...base, [field]: "2024-02-29" })[field]).toEqual(new Date("2024-02-29T00:00:00Z"));
    });
  }
});
