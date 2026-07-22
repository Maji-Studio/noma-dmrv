import { describe, expect, it } from "vitest";
import { deriveMethodBEligibility } from "./method-b-eligibility";

const prerequisites = {
  productionProcessId: "process-1",
  agreedBaselineSize: 30,
  randomSamplingPlanRef: "PDD §8.3",
  moisturePathway: "measured_every_batch",
};

describe("deriveMethodBEligibility", () => {
  it("uses the floor and rejects unsampled when prerequisites are absent", () => {
    expect(
      deriveMethodBEligibility({
        productionProcessId: "process-1",
        eligibleSampleCount: 30,
        agreedBaselineSize: null,
        randomSamplingPlanRef: null,
        moisturePathway: null,
      }),
    ).toEqual({
      productionProcessId: "process-1",
      eligibleSampleCount: 30,
      agreedBaselineSize: 30,
      prerequisitesRecorded: false,
      randomSamplingPlanRef: null,
      moisturePathway: null,
      unsampledAllowed: false,
    });
  });

  it("rejects below the agreed threshold even with prerequisites", () => {
    expect(
      deriveMethodBEligibility({ ...prerequisites, eligibleSampleCount: 29 }),
    ).toMatchObject({ prerequisitesRecorded: true, unsampledAllowed: false });
  });

  it("allows unsampled at the agreed threshold with all prerequisites", () => {
    expect(
      deriveMethodBEligibility({ ...prerequisites, eligibleSampleCount: 30 }),
    ).toMatchObject({ prerequisitesRecorded: true, unsampledAllowed: true });
  });

  it("honours an agreed threshold above the protocol floor", () => {
    expect(
      deriveMethodBEligibility({
        ...prerequisites,
        agreedBaselineSize: 40,
        eligibleSampleCount: 39,
      }),
    ).toMatchObject({ agreedBaselineSize: 40, unsampledAllowed: false });
  });
});
