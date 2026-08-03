import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  SampleCreateAction,
  sampleProvenanceLabel,
} from "./credit-batch-durability-panel";

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

describe("SampleCreateAction", () => {
  it("keeps the direct create action for a partially sampled batch", () => {
    const html = renderToStaticMarkup(
      createElement(SampleCreateAction, {
        facilityId: "facility-1",
        creditBatchId: "batch-1",
        hasSamples: true,
      }),
    );

    expect(html).toContain("Record another Sample");
    expect(html).toContain(
      '/samples?facility=facility-1&amp;create=true&amp;createCreditBatch=batch-1',
    );
  });
});
