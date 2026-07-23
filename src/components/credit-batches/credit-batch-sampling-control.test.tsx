import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreditBatchSamplingControl } from "./credit-batch-sampling-control";

const ineligible = {
  productionProcessId: "process-1",
  eligibleSampleCount: 23,
  agreedBaselineSize: 30,
  prerequisitesRecorded: false,
  randomSamplingPlanRef: null,
  moisturePathway: null,
  unsampledAllowed: false,
};

const eligible = {
  ...ineligible,
  eligibleSampleCount: 30,
  prerequisitesRecorded: true,
  randomSamplingPlanRef: "PDD §8.3",
  moisturePathway: "measured_every_batch",
  unsampledAllowed: true,
};

describe("CreditBatchSamplingControl", () => {
  it("disables unsampled while the baseline is incomplete", () => {
    const html = renderToStaticMarkup(
      <CreditBatchSamplingControl
        visible
        isEditMode={false}
        value="sampled"
        onChange={vi.fn()}
        eligibility={ineligible}
        canManage={false}
      />,
    );

    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="unsampled"/);
    // The eligibility explanation now lives behind the ⓘ hint on the legend.
    expect(html).toContain("About sampling eligibility");
  });

  it("enables unsampled when computed eligibility is satisfied", () => {
    const html = renderToStaticMarkup(
      <CreditBatchSamplingControl
        visible
        isEditMode={false}
        value="sampled"
        onChange={vi.fn()}
        eligibility={eligible}
        canManage={false}
      />,
    );

    expect(html).toContain('value="unsampled"');
    expect(html).not.toMatch(/<input[^>]*disabled=""[^>]*value="unsampled"/);
    expect(html).toContain("About sampling eligibility");
  });

  it("shows the existing choice read-only in edit mode", () => {
    const html = renderToStaticMarkup(
      <CreditBatchSamplingControl
        visible
        isEditMode
        value="unsampled"
        onChange={vi.fn()}
        eligibility={eligible}
        canManage
      />,
    );

    expect(html).toContain("Sampling: Unsampled");
    expect(html).toContain("cannot be changed");
    expect(html).not.toContain('type="radio"');
  });

  it("renders nothing when the Isometric/feedstock gate is closed", () => {
    const html = renderToStaticMarkup(
      <CreditBatchSamplingControl
        visible={false}
        isEditMode={false}
        value="sampled"
        onChange={vi.fn()}
        eligibility={eligible}
        canManage={false}
      />,
    );

    expect(html).toBe("");
  });
});
