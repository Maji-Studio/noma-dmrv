import { describe, expect, it } from "vitest";
import { assertUnsampledBatchEligibility } from "./credit-batch-sampling";

describe("assertUnsampledBatchEligibility", () => {
  it("rejects unsampled creation when computed eligibility is false", () => {
    expect(() =>
      assertUnsampledBatchEligibility({
        eligibleSampleCount: 29,
        agreedBaselineSize: 30,
        unsampledAllowed: false,
      }),
    ).toThrow(/29 of 30 eligible samples/i);
  });

  it("accepts unsampled creation when computed eligibility is true", () => {
    expect(() =>
      assertUnsampledBatchEligibility({
        eligibleSampleCount: 30,
        agreedBaselineSize: 30,
        unsampledAllowed: true,
      }),
    ).not.toThrow();
  });
});
