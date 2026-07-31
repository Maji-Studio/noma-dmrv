import { describe, expect, it } from "vitest";
import {
  COMBINED_CARBON_EXCEEDS_TOTAL_MESSAGE,
  getSampleCarbonReconciliationErrors,
  ORGANIC_CARBON_EXCEEDS_TOTAL_MESSAGE,
} from "./samples";

describe("getSampleCarbonReconciliationErrors", () => {
  it("reports organic carbon above total carbon as soon as both values are complete", () => {
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
        organicCarbonPercent: 76,
      }),
    ).toEqual({
      organicCarbonPercent: ORGANIC_CARBON_EXCEEDS_TOTAL_MESSAGE,
    });
  });

  it("stays silent until the relevant values are complete and outside tolerance", () => {
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
      }),
    ).toEqual({});
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
        organicCarbonPercent: 75.5,
      }),
    ).toEqual({});
  });

  it("reports the combined carbon overage once inorganic carbon is complete", () => {
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
        organicCarbonPercent: 74,
        inorganicCarbonPercent: 2,
      }),
    ).toEqual({
      inorganicCarbonPercent: COMBINED_CARBON_EXCEEDS_TOTAL_MESSAGE,
    });
  });
});
