import { describe, expect, it } from "vitest";
import { getSampleCarbonReconciliationErrors } from "./sample-carbon-reconciliation";

describe("getSampleCarbonReconciliationErrors", () => {
  it("reports organic carbon above total carbon as soon as both values are complete", () => {
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
        organicCarbonPercent: 76,
      }),
    ).toEqual({
      organicCarbonPercent: "Organic carbon exceeds total carbon.",
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
      inorganicCarbonPercent:
        "Organic and inorganic carbon exceed total carbon.",
    });
  });
});
