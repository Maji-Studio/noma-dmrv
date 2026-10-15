import { describe, expect, it } from "vitest";
import { sampleDocumentWarnings } from "./sample-document-warnings";

describe("sample document advisories", () => {
  it("warns only for a sampled batch with no uploaded lab report", () => {
    expect(sampleDocumentWarnings({ sampling: "sampled", creditBatchCode: "CB-1", hasLabReport: false })).toEqual([
      "Credit batch CB-1 has no lab report document. Upload a lab report to one of its Samples. You can still submit the Removal.",
    ]);
    expect(sampleDocumentWarnings({ sampling: "sampled", creditBatchCode: "CB-1", hasLabReport: true })).toEqual([]);
    expect(sampleDocumentWarnings({ sampling: "unsampled", creditBatchCode: "CB-1", hasLabReport: false })).toEqual([]);
  });
});
