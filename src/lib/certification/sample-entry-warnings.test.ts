import { describe, expect, it } from "vitest";
import { evaluateSampled1000YearReplicates } from "./durability-1000-replicates";
import { R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE, sampleEntryWarnings, type SampleEntryFacts } from "./sample-entry-warnings";

const complete: SampleEntryFacts = {
  sampleCode: "SAM-26-001", creditBatchCode: "CB-26-001", durabilityOption: "1000_year", sampling: "sampled",
  totalCarbonPercent: 80, inorganicCarbonPercent: 3, sReflectanceFraction: 0.9,
  totalHydrogenPercent: 1.5, moistureContentPercent: 10, r0MeasurementCount: R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE,
  organicCarbonPercent: 75, totalOxygenPercent: 6, hToCOrgRatio: 0.2383, oToCOrgRatio: 0.06,
};

describe("sampleEntryWarnings", () => {
  it("includes the batch lab-report advisory in Sample save warnings", () => {
    expect(sampleEntryWarnings({ ...complete, hasLabReport: false })).toEqual([
      "Credit batch CB-26-001 has no lab report document. Upload a lab report to one of its Samples. You can still submit the Removal.",
    ]);
  });

  it("is silent for a complete 1,000-year Sample", () => {
    expect(sampleEntryWarnings(complete)).toEqual([]);
  });

  it("names the measurements the submission gate blocks on, by the gate's own rule", () => {
    const missing = { ...complete, inorganicCarbonPercent: null, sReflectanceFraction: null };
    expect(sampleEntryWarnings(missing)).toEqual([
      "Sample SAM-26-001 is missing measured inorganic carbon and the R₀ fraction at or above 2%. A 1,000-year Removal with credit batch CB-26-001 cannot be submitted until every Sample has them.",
    ]);
    // The gate blocks a batch made of this Sample for the same two measurements.
    const gate = evaluateSampled1000YearReplicates({ creditBatchCode: "CB-26-001", samples: [{ id: "s1", ...missing }] });
    expect(gate.blockers).toEqual(expect.arrayContaining([
      "Credit batch CB-26-001 has 1 Sample missing measured inorganic carbon: SAM-26-001. Record the measured value on every Sample before submitting a 1,000-year Removal.",
      "Credit batch CB-26-001 has 1 Sample missing the R₀ fraction at or above 2%: SAM-26-001. Record the measured value on every Sample before submitting a 1,000-year Removal.",
    ]));
  });

  it.each([
    { fields: ["totalCarbonPercent"], measurements: "total carbon", pronoun: "it" },
    { fields: ["inorganicCarbonPercent"], measurements: "measured inorganic carbon", pronoun: "it" },
    { fields: ["sReflectanceFraction"], measurements: "the R₀ fraction at or above 2%", pronoun: "it" },
    { fields: ["totalCarbonPercent", "inorganicCarbonPercent"], measurements: "total carbon and measured inorganic carbon", pronoun: "them" },
    { fields: ["totalCarbonPercent", "sReflectanceFraction"], measurements: "total carbon and the R₀ fraction at or above 2%", pronoun: "them" },
    { fields: ["inorganicCarbonPercent", "sReflectanceFraction"], measurements: "measured inorganic carbon and the R₀ fraction at or above 2%", pronoun: "them" },
    { fields: ["totalCarbonPercent", "inorganicCarbonPercent", "sReflectanceFraction"], measurements: "total carbon, measured inorganic carbon and the R₀ fraction at or above 2%", pronoun: "them" },
  ])("uses grammatical copy when missing $measurements", ({ fields, measurements, pronoun }) => {
    const missing = Object.fromEntries(fields.map((field) => [field, null]));
    expect(sampleEntryWarnings({ ...complete, ...missing })).toEqual([
      `Sample SAM-26-001 is missing ${measurements}. A 1,000-year Removal with credit batch CB-26-001 cannot be submitted until every Sample has ${pronoun}.`,
    ]);
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
      "Sample SAM-26-001 is missing moisture content. A Removal with credit batch CB-26-001 cannot be submitted until every Sample has it.",
    ]);
  });

  it("never uses an en or em dash", () => {
    const all = sampleEntryWarnings({ ...complete, inorganicCarbonPercent: null, totalHydrogenPercent: null, moistureContentPercent: null, r0MeasurementCount: 1 });
    expect(all.join(" ")).not.toMatch(/[–—]/);
  });

  it("warns when a sampled Sample has no O/C_org: no oxygen and no lab ratio", () => {
    const warnings = sampleEntryWarnings({ ...complete, durabilityOption: "200_year", totalOxygenPercent: null, oToCOrgRatio: null });
    expect(warnings).toEqual([
      "Sample SAM-26-001 has no O/C_org, so it is not one of the 3 Samples with complete H/C_org and O/C_org results credit batch CB-26-001 needs before submitting. Enter total oxygen, or the lab's O/C_org when the lab reported no oxygen.",
    ]);
  });

  it("warns when zero organic carbon leaves both ratios empty", () => {
    const warnings = sampleEntryWarnings({ ...complete, durabilityOption: "200_year", organicCarbonPercent: 0, hToCOrgRatio: null, oToCOrgRatio: null });
    expect(warnings).toEqual([
      "Sample SAM-26-001 has no H/C_org and O/C_org, so it is not one of the 3 Samples with complete H/C_org and O/C_org results credit batch CB-26-001 needs before submitting. With organic carbon at 0, neither ratio can be calculated. Check the organic carbon value.",
    ]);
  });

  it("does not repeat the missing hydrogen line as a ratio hint, and skips unsampled batches", () => {
    const noHydrogen = { ...complete, durabilityOption: "200_year" as const, totalHydrogenPercent: null, hToCOrgRatio: null };
    const warnings = sampleEntryWarnings(noHydrogen);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^Sample SAM-26-001 has no total hydrogen/);
    expect(warnings[1]).toBe("Sample SAM-26-001 has no H/C_org, so it is not one of the 3 Samples with complete H/C_org and O/C_org results credit batch CB-26-001 needs before submitting.");
    expect(sampleEntryWarnings({ ...noHydrogen, sampling: "unsampled" })).toEqual([]);
  });

  it("skips moisture and incidental chemistry warnings on unsampled batches", () => {
    expect(sampleEntryWarnings({ ...complete, durabilityOption: "200_year", sampling: "unsampled",
      organicCarbonPercent: null, totalHydrogenPercent: null, hToCOrgRatio: null, oToCOrgRatio: null,
      moistureContentPercent: null,
    })).toEqual([]);
  });
});
