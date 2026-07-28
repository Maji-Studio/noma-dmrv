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
    ).toThrow(/at least 30 eligible Samples.*29 eligible Samples/);
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
