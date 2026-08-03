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
    ).toThrow(
      "This process has 29 qualifying Method-A Samples. Record at least 30 and complete the Method-B prerequisites before creating an unsampled credit batch.",
    );
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
