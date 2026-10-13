import { describe, expect, it } from "vitest";
import { H_TO_C_ORG_ELIGIBILITY_MAX, O_TO_C_ORG_ELIGIBILITY_MAX } from "./biochar-eligibility";
import {
  calculateHToCOrgRatio,
  calculateOToCOrgRatio,
  deriveSampleRatios,
  previewSampleRatios,
  SampleRatioCapError,
} from "./sample-ratios";
import { RATIO_INPUT_MAX } from "@/schemas/helpers";

const NO_INPUTS = { totalHydrogenPercent: null, totalOxygenPercent: null, organicCarbonPercent: null, oToCOrgRatio: null };

/** The form's submit-time derivation before the shared helper, kept as the parity reference. */
function previousFormRatios(values: { totalHydrogenPercent: number | null; totalOxygenPercent: number | null; organicCarbonPercent: number; oToCOrgRatio: number | null }) {
  const hToC = calculateHToCOrgRatio(values.totalHydrogenPercent, values.organicCarbonPercent);
  const oToC = calculateOToCOrgRatio(values.totalOxygenPercent, values.organicCarbonPercent);
  return {
    hToCOrgRatio: hToC === null ? null : parseFloat(hToC.toFixed(4)),
    oToCOrgRatio: values.oToCOrgRatio ?? (oToC === null ? null : parseFloat(oToC.toFixed(4))),
  };
}

describe("deriveSampleRatios", () => {
  it("derives both ratios at four decimals and says each was calculated", () => {
    const result = deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: 2.5, totalOxygenPercent: 12, organicCarbonPercent: 71.5 });
    expect(result.hToCOrgRatio).toBe(0.4166);
    expect(result.oToCOrgRatio).toBe(0.126);
    expect(result.notices).toEqual([
      { field: "hToCOrgRatio", message: "H/C_org calculated from hydrogen and organic carbon: 0.4166" },
      { field: "oToCOrgRatio", message: "O/C_org calculated from oxygen and organic carbon: 0.1260" },
    ]);
  });

  it("matches the previous form output on real lab values", () => {
    const cases = [
      { totalHydrogenPercent: 1.8, totalOxygenPercent: 8.4, organicCarbonPercent: 72.6, oToCOrgRatio: null },
      { totalHydrogenPercent: 2.1, totalOxygenPercent: null, organicCarbonPercent: 78, oToCOrgRatio: 0.11 },
      { totalHydrogenPercent: 3.05, totalOxygenPercent: 15.2, organicCarbonPercent: 64.33, oToCOrgRatio: null },
      { totalHydrogenPercent: null, totalOxygenPercent: 9.9, organicCarbonPercent: 80, oToCOrgRatio: null },
    ];
    for (const values of cases) {
      const { hToCOrgRatio, oToCOrgRatio } = deriveSampleRatios(values);
      expect({ hToCOrgRatio, oToCOrgRatio }).toEqual(previousFormRatios(values));
    }
  });

  it("returns null H/C_org for cleared inputs and a zero organic carbon, never a stale ratio", () => {
    expect(deriveSampleRatios({ ...NO_INPUTS, organicCarbonPercent: 70 })).toMatchObject({ hToCOrgRatio: null, notices: [] });
    expect(deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: 2 }).hToCOrgRatio).toBeNull();
    expect(deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: 2, totalOxygenPercent: 10, organicCarbonPercent: 0 }))
      .toEqual({ hToCOrgRatio: null, oToCOrgRatio: null, notices: [] });
  });

  it("derives a zero ratio from an explicit zero hydrogen or oxygen", () => {
    expect(deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: 0, totalOxygenPercent: 0, organicCarbonPercent: 70 })).toEqual({
      hToCOrgRatio: 0,
      oToCOrgRatio: 0,
      notices: [
        { field: "hToCOrgRatio", message: "H/C_org calculated from hydrogen and organic carbon: 0.0000" },
        { field: "oToCOrgRatio", message: "O/C_org calculated from oxygen and organic carbon: 0.0000" },
      ],
    });
  });

  it("calculates O/C_org whenever oxygen is present and keeps a lab O/C_org only without oxygen", () => {
    expect(deriveSampleRatios({ ...NO_INPUTS, totalOxygenPercent: 12, organicCarbonPercent: 71.5, oToCOrgRatio: 0.05 }).oToCOrgRatio).toBe(0.126);
    const supplied = deriveSampleRatios({ ...NO_INPUTS, organicCarbonPercent: 71.5, oToCOrgRatio: 0.05 });
    expect(supplied).toEqual({ hToCOrgRatio: null, oToCOrgRatio: 0.05, notices: [] });
    expect(deriveSampleRatios({ ...NO_INPUTS, organicCarbonPercent: 71.5 }).oToCOrgRatio).toBeNull();
  });

  it("judges eligibility on the rounded ratio at the 0.5 and 0.2 boundaries", () => {
    // 0.499996 and 0.199996 round up onto the ceilings, so the saved figure is not below them.
    const hydrogenAtCeiling = 0.499996 * 1.008 * 70 / 12.011;
    const oxygenAtCeiling = 0.199996 * 15.999 * 70 / 12.011;
    const atCeiling = deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: hydrogenAtCeiling, totalOxygenPercent: oxygenAtCeiling, organicCarbonPercent: 70 });
    expect(atCeiling.hToCOrgRatio).toBe(H_TO_C_ORG_ELIGIBILITY_MAX);
    expect(atCeiling.oToCOrgRatio).toBe(O_TO_C_ORG_ELIGIBILITY_MAX);
    const hydrogenBelow = 0.499949 * 1.008 * 70 / 12.011;
    const oxygenBelow = 0.199949 * 15.999 * 70 / 12.011;
    const below = deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: hydrogenBelow, totalOxygenPercent: oxygenBelow, organicCarbonPercent: 70 });
    expect(below.hToCOrgRatio).toBe(0.4999);
    expect(below.oToCOrgRatio).toBe(0.1999);
  });

  it("refuses a ratio that rounds above the stored maximum and points at the input behind it", () => {
    // 9.99996 rounds to 10.0000, above the numeric(7,6) ceiling: refused, not clamped.
    const hydrogen = 9.99996 * 1.008 * 1 / 12.011;
    expect(() => deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: hydrogen, organicCarbonPercent: 1 })).toThrow(SampleRatioCapError);
    try {
      deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: hydrogen, organicCarbonPercent: 1 });
    } catch (error) {
      expect(error).toMatchObject({ ratio: "hToCOrgRatio", field: "totalHydrogenPercent", value: 10 });
      expect((error as Error).message).toBe(`H/C_org calculated from hydrogen and organic carbon is 10.0000, above the maximum of ${RATIO_INPUT_MAX}. Check the hydrogen and organic carbon values.`);
    }
    expect(() => deriveSampleRatios({ ...NO_INPUTS, totalOxygenPercent: 50, organicCarbonPercent: 1 }))
      .toThrow(expect.objectContaining({ ratio: "oToCOrgRatio", field: "totalOxygenPercent" }));
    const justBelow = 9.99994 * 1.008 * 1 / 12.011;
    expect(deriveSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: justBelow, organicCarbonPercent: 1 }).hToCOrgRatio).toBe(9.9999);
  });
});

describe("previewSampleRatios", () => {
  it("shows what will be saved without refusing, and names where O/C_org came from", () => {
    expect(previewSampleRatios({ ...NO_INPUTS, totalHydrogenPercent: 1, organicCarbonPercent: 0.1 }).hToCOrgRatio).toBeGreaterThan(RATIO_INPUT_MAX);
    expect(previewSampleRatios({ ...NO_INPUTS, totalOxygenPercent: 12, organicCarbonPercent: 71.5, oToCOrgRatio: 0.05 }).oToCOrgSource).toBe("calculated");
    expect(previewSampleRatios({ ...NO_INPUTS, organicCarbonPercent: 71.5, oToCOrgRatio: 0.05 }).oToCOrgSource).toBe("lab");
    expect(previewSampleRatios(NO_INPUTS).oToCOrgSource).toBeNull();
  });
});
