import { describe, expect, it } from "vitest";
import { evaluateSampled1000YearReplicates } from "./durability-1000-replicates";
import { R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE, sampleEntryWarnings, type SampleEntryFacts } from "./sample-entry-warnings";

const complete: SampleEntryFacts = {
  sampleCode: "SAM-26-001", creditBatchCode: "CB-26-001", durabilityOption: "1000_year", sampling: "sampled",
  totalCarbonPercent: 80, inorganicCarbonPercent: 3, sReflectanceFraction: 0.9,
  totalHydrogenPercent: 1.5, moistureContentPercent: 10, r0MeasurementCount: R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE,
};

describe("sampleEntryWarnings", () => {
  it("is silent for a complete 1,000-year Sample", () => {
    expect(sampleEntryWarnings(complete)).toEqual([]);
  });

  it("names the measurements the submission gate blocks on, by the gate's own rule", () => {
    const missing = { ...complete, inorganicCarbonPercent: null, sReflectanceFraction: null };
    expect(sampleEntryWarnings(missing)).toEqual([
      "Sample SAM-26-001 has no measured inorganic carbon and the R₀ fraction at or above 2%. A 1,000-year Removal with credit batch CB-26-001 cannot be submitted until every Sample has them.",
    ]);
    // The gate blocks a batch made of this Sample for the same two measurements.
    const gate = evaluateSampled1000YearReplicates({ creditBatchCode: "CB-26-001", samples: [{ id: "s1", ...missing }] });
    expect(gate.blockers.join(" ")).toMatch(/missing measured inorganic carbon.*missing the R₀ fraction at or above 2%/);
  });

  it("does not warn on 1,000-year measurements for an unsampled batch or a 200-year batch", () => {
    const missing = { ...complete, inorganicCarbonPercent: null, sReflectanceFraction: null, r0MeasurementCount: null };
    expect(sampleEntryWarnings({ ...missing, sampling: "unsampled" })).toHaveLength(1);
    expect(sampleEntryWarnings({ ...missing, durabilityOption: "200_year" })).toEqual([]);
  });

  it("warns under 500 R₀ readings and says submission is still allowed", () => {
    const [warning] = sampleEntryWarnings({ ...complete, r0MeasurementCount: R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE - 1 });
    expect(warning).toBe("Sample SAM-26-001 has 499 R₀ measurements. For 1,000-year crediting the biochar module asks for at least 500 per Sample. You can still submit the Removal.");
    expect(sampleEntryWarnings({ ...complete, r0MeasurementCount: null })[0]).toMatch(/^Sample SAM-26-001 has no R₀ measurement count\./);
  });

  it("warns on any tier for missing hydrogen and moisture", () => {
    const warnings = sampleEntryWarnings({ ...complete, durabilityOption: "200_year", totalHydrogenPercent: null, moistureContentPercent: null });
    expect(warnings).toEqual([
      "Sample SAM-26-001 has no total hydrogen, so H/C_org cannot be calculated. The biochar module requires H/C_org for every production batch (Table 2).",
      "Sample SAM-26-001 has no moisture content. The biochar module requires moisture for every production batch (Table 2).",
    ]);
  });

  it("never uses an en or em dash", () => {
    const all = sampleEntryWarnings({ ...complete, inorganicCarbonPercent: null, totalHydrogenPercent: null, moistureContentPercent: null, r0MeasurementCount: 1 });
    expect(all.join(" ")).not.toMatch(/[–—]/);
  });
});
