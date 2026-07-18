import { describe, expect, it } from "vitest";
import { sampleFormSchema, updateSampleSchema } from "@/schemas/samples";
import { RATIO_INPUT_MAX, RATIO_MAX_MESSAGE } from "@/schemas/helpers";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// #400: hToCOrgRatio / oToCOrgRatio are backed by numeric(7,6) DB columns
// (single integer digit + 6 decimal digits). Out-of-scale input must fail
// Zod inline instead of reaching Postgres as a raw 22003 overflow — mirrors
// the mass-cap approach from #345 (tests/mass-input-caps.test.ts).
describe("sample ratio input caps", () => {
  it("rejects an hToCOrgRatio above the numeric(7,6) cap", () => {
    const result = updateSampleSchema.safeParse({
      sampleId: UUID,
      hToCOrgRatio: RATIO_INPUT_MAX + 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["hToCOrgRatio"],
            message: RATIO_MAX_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("rejects an oToCOrgRatio above the numeric(7,6) cap", () => {
    const result = updateSampleSchema.safeParse({
      sampleId: UUID,
      oToCOrgRatio: RATIO_INPUT_MAX + 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["oToCOrgRatio"],
            message: RATIO_MAX_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("accepts ratios exactly at the cap", () => {
    const result = updateSampleSchema.safeParse({
      sampleId: UUID,
      hToCOrgRatio: RATIO_INPUT_MAX,
      oToCOrgRatio: RATIO_INPUT_MAX,
    });

    expect(result.success).toBe(true);
  });

  const formBase = {
    creditBatchId: UUID,
    samplingTime: new Date("2026-07-01"),
    totalCarbonPercent: 50,
    organicCarbonPercent: 45,
  };

  it("rejects an out-of-range ratio on the sample form schema", () => {
    const result = sampleFormSchema.safeParse({
      ...formBase,
      hToCOrgRatio: RATIO_INPUT_MAX + 5,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["hToCOrgRatio"],
            message: RATIO_MAX_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("accepts an in-range ratio on the sample form schema", () => {
    const result = sampleFormSchema.safeParse({
      ...formBase,
      hToCOrgRatio: 0.6,
      oToCOrgRatio: 0.3,
    });

    expect(result.success).toBe(true);
  });
});
