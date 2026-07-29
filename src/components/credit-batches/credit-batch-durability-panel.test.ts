import { describe, expect, it } from "vitest";
import { sampleProvenanceLabel } from "./credit-batch-durability-panel";

describe("sampleProvenanceLabel", () => {
  it("uses neutral batch provenance when a sample has no production run", () => {
    expect(
      sampleProvenanceLabel({
        productionRunCode: null,
        samplingDay: "2026-06-13",
      }),
    ).toBe("Batch Sample · Jun 13, 2026");
  });

  it("shows the production run only when provenance includes one", () => {
    expect(
      sampleProvenanceLabel({
        productionRunCode: "PR-001",
        samplingDay: "2026-06-13",
      }),
    ).toBe("PR-001 · Jun 13, 2026");
  });
});
