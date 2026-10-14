import { describe, expect, it, vi } from "vitest";

// The tier guard is pure; lineage locking is covered by the operation DB suite.
vi.mock("../certification-lineage-guards", () => ({}));

import { assertBatchTierEvidence } from "./write-scope";

const facility = { durabilityOption: "1000_year" as const, timeZone: "UTC" };
const evidence = {
  randomReflectanceR0Percent: 2.4,
  reactiveCarbonPercent: null,
  residualCarbonPercent: 65,
  sReflectanceFraction: null,
};

describe("assertBatchTierEvidence", () => {
  it("allows missing s_fraction at save time", () => {
    expect(() => assertBatchTierEvidence(facility, evidence)).not.toThrow();
  });

  it("still requires mean R₀ and either TGA measurement", () => {
    expect(() => assertBatchTierEvidence(facility, { ...evidence, randomReflectanceR0Percent: null })).toThrow();
    expect(() => assertBatchTierEvidence(facility, { ...evidence, residualCarbonPercent: null })).toThrow();
    expect(() => assertBatchTierEvidence(facility, { ...evidence, residualCarbonPercent: null, reactiveCarbonPercent: 35 })).not.toThrow();
  });
});
