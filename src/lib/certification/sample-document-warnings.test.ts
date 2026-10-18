import { describe, expect, it } from "vitest";
import { sampleDocumentWarningKeys, sampleDocumentWarnings } from "./sample-document-warnings";

describe("sample document advisories", () => {
  it("warns only for a sampled batch with no uploaded lab report", () => {
    expect(sampleDocumentWarnings({ sampling: "sampled", creditBatchCode: "CB-1", hasLabReport: false })).toEqual([
      "Credit batch CB-1 has no lab report document. Upload a lab report to one of its Samples. You can still submit the Removal.",
    ]);
    expect(sampleDocumentWarnings({ sampling: "sampled", creditBatchCode: "CB-1", hasLabReport: true })).toEqual([]);
    expect(sampleDocumentWarnings({ sampling: "unsampled", creditBatchCode: "CB-1", hasLabReport: false })).toEqual([]);
  });
});

const histogramFacts = { sampling: "sampled" as const, creditBatchCode: "CB-1", durabilityOption: "1000_year" as const, hasReflectanceHistogram: false };
it("warns about a missing histogram only for loaded, sampled 1,000-year evidence", () => {
  expect(sampleDocumentWarnings(histogramFacts)).toEqual([
    "Credit batch CB-1 has no reflectance histogram document. Upload a reflectance histogram to one of its Samples. You can still submit the Removal.",
  ]);
  expect(sampleDocumentWarnings({ ...histogramFacts, hasReflectanceHistogram: true })).toEqual([]);
  expect(sampleDocumentWarnings({ ...histogramFacts, hasReflectanceHistogram: undefined })).toEqual([]);
  expect(sampleDocumentWarnings({ ...histogramFacts, sampling: "unsampled" })).toEqual([]);
  expect(sampleDocumentWarnings({ ...histogramFacts, durabilityOption: "200_year" })).toEqual([]);
  expect(sampleDocumentWarnings({ ...histogramFacts, durabilityOption: null })).toEqual([]);
});

it("keys the same gaps the sentences name", () => {
  const facts = { sampling: "sampled" as const, creditBatchCode: "CB-1", hasLabReport: false, hasReflectanceHistogram: false, durabilityOption: "1000_year" as const };
  expect(sampleDocumentWarningKeys(facts)).toEqual(["labReport", "reflectanceHistogram"]);
  expect(sampleDocumentWarningKeys({ ...facts, durabilityOption: "200_year" })).toEqual(["labReport"]);
  expect(sampleDocumentWarningKeys({ ...facts, sampling: "unsampled" })).toEqual([]);
});
