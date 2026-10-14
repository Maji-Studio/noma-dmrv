import { describe, expect, it } from "vitest";
import { deriveEntityCertifyReadiness } from "./entity-readiness";
import { evaluateDurabilitySubmissionGates } from "./durability-submission-gates";
import { evaluateSampled1000YearReplicates } from "./durability-1000-replicates";

const chemistryKeys = ["organicCarbonPercent", "hToCOrgRatio", "oToCOrgRatio"];

describe("Sample certification descriptor scope", () => {
  it.each(["200_year", "1000_year"])("matches the chemistry gate for sampled and unsampled %s batches", (durabilityOption) => {
    for (const sampling of ["sampled", "unsampled"] as const) {
      const readiness = deriveEntityCertifyReadiness("sample", { durabilityOption, sampling });
      expect(readiness.gaps.filter((gap) => chemistryKeys.includes(gap.key)).map((gap) => gap.key))
        .toEqual(sampling === "sampled" ? chemistryKeys : []);
      const gate = evaluateDurabilitySubmissionGates([{
        creditBatchId: "batch", creditBatchCode: "CB-1", sampling,
        replicates: [{ hToCOrgRatio: null, oToCOrgRatio: null }],
        replicateProvenance: [{ sampleCode: "SAM-1", samplingDay: null }],
      }]);
      expect(gate.ok).toBe(sampling === "unsampled");
    }
  });

  it.each([
    ["1000_year", "sampled", true],
    ["1000_year", "unsampled", false],
    ["200_year", "sampled", false],
    ["200_year", "unsampled", false],
    [null, "sampled", false],
  ])("requires s_fraction only for sampled 1,000-year evidence (%s, %s)", (durabilityOption, sampling, required) => {
    const readiness = deriveEntityCertifyReadiness("sample", { durabilityOption, sampling });
    expect(readiness.gaps.some((gap) => gap.key === "sReflectanceFraction")).toBe(required);
  });

  it("continues blocking certification when a saved Sample has no s_fraction", () => {
    const sample = { id: "sample", sampleCode: "SAM-1", totalCarbonPercent: 80, inorganicCarbonPercent: 2, sReflectanceFraction: null };
    const gate = evaluateSampled1000YearReplicates({ creditBatchCode: "CB-1", samples: [sample] });
    expect(gate.blockers).toContain("Credit batch CB-1 has 1 Sample missing the R₀ fraction at or above 2%: SAM-1. Record the measured value on every Sample before submitting a 1,000-year Removal.");
  });
});
