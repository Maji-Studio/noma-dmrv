import { describe, expect, it } from "vitest";
import { getUnsampledBatchEligibilityIssue } from "./credit-batch-sampling";

describe("getUnsampledBatchEligibilityIssue", () => {
  it("rejects unsampled creation when computed eligibility is false", () => {
    expect(
      getUnsampledBatchEligibilityIssue({
        eligibleSampleCount: 29,
        agreedBaselineSize: 30,
        unsampledAllowed: false,
      }),
    ).toBe(
      "This process has 29 qualifying Method-A Samples. Record at least 30 and complete the Method-B prerequisites before creating an unsampled credit batch.",
    );
  });

  it("accepts unsampled creation when computed eligibility is true", () => {
    expect(
      getUnsampledBatchEligibilityIssue({
        eligibleSampleCount: 30,
        agreedBaselineSize: 30,
        unsampledAllowed: true,
      }),
    ).toBeNull();
  });
});
