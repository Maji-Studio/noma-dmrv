import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The block's InfoHint is a Base UI tooltip, which needs a DOM this node
// environment does not have; the hint's copy is not what these tests assert.
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
import { FormDetailProvider } from "@/components/forms/form-detail-context";
import { ProcessFlowPreview } from "./production-run-process-flow-preview";

const run = {
  sourceBinName: "Feedstock July",
  feedstockKg: 100,
  feedstockMoisturePercent: 10,
  feedstockDryKg: 90,
  reactorName: "Reactor 1",
  biocharKg: 50,
  biocharMoisturePercent: 10,
  biocharDryKg: 45,
  destinationBinName: "Biochar July",
};

/** Text as the operator reads it, with the markup and its entities resolved. */
function text(node: ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}

describe("ProcessFlowPreview", () => {
  it("reads as a journey: three stops, the feedstock in, the biochar out and the dry yield", () => {
    const rendered = text(<ProcessFlowPreview {...run} />);

    expect(rendered).toContain("Feedstock July");
    expect(rendered).toContain("Reactor 1");
    expect(rendered).toContain("Biochar July");
    expect(rendered).toContain("Feedstock in");
    expect(rendered).toContain("100 kg wet");
    expect(rendered).toContain("Dry feedstock 90 kg");
    expect(rendered).toContain("Biochar out");
    expect(rendered).toContain("50 kg wet");
    expect(rendered).toContain("Dry biochar 45 kg");
    expect(rendered).toContain("Dry yield 50%");
    // Each stop comes before the segment leaving it.
    expect(rendered.indexOf("Feedstock July")).toBeLessThan(rendered.indexOf("Feedstock in"));
    expect(rendered.indexOf("Reactor 1")).toBeLessThan(rendered.indexOf("Biochar out"));
    expect(rendered.indexOf("Biochar out")).toBeLessThan(rendered.indexOf("Biochar July"));
  });

  it("keeps the yield arithmetic behind the block's own disclosure", () => {
    const html = renderToStaticMarkup(<ProcessFlowPreview {...run} />);

    expect(html).toContain("Show calculation for process flow");
    expect(html).toContain("Dry feedstock in");
    expect(html).toContain("Dry biochar out");
    expect(html).toContain("Dry yield = biochar out / feedstock in. 45 kg / 90 kg = 50%.");
  });

  it("shows the rail and the yield in Simple and adds the calculation in Detailed", () => {
    const simple = renderToStaticMarkup(
      <FormDetailProvider scope="production-run"><ProcessFlowPreview {...run} /></FormDetailProvider>,
    );

    expect(simple).toContain("Feedstock July");
    expect(simple).toContain("Dry yield");
    expect(simple).not.toContain("Show calculation");
    expect(simple).not.toContain("Dry yield = biochar out");
  });

  it("falls back to wet yield when the output dry mass is unresolved", () => {
    const rendered = text(<ProcessFlowPreview {...run} biocharMoisturePercent={null} biocharDryKg={null} />);

    expect(rendered).toContain("Wet yield 50%");
    expect(rendered).toContain("Moisture not recorded. Biochar dry mass cannot be calculated.");
    expect(rendered).toContain("Dry feedstock 90 kg");
    expect(rendered).not.toContain("Dry biochar 45 kg");
  });

  it("falls back to wet yield when the input dry mass is unresolved", () => {
    const rendered = text(<ProcessFlowPreview {...run} feedstockMoisturePercent={null} feedstockDryKg={null} />);

    expect(rendered).toContain("Wet yield 50%");
    expect(rendered).toContain("Moisture not recorded. Feedstock dry mass cannot be calculated.");
    expect(rendered).toContain("Dry biochar 45 kg");
  });

  it("names the field to fill at every unpicked stop, and renders nothing before the first one", () => {
    const rendered = text(
      <ProcessFlowPreview {...run} sourceBinName={null} reactorName={null} destinationBinName="Biochar July" />,
    );

    expect(rendered).toContain("Select source bin");
    expect(rendered).toContain("Select reactor");
    expect(rendered).not.toContain("Select destination bin");
    expect(
      renderToStaticMarkup(<ProcessFlowPreview {...run} sourceBinName={null} reactorName={null} destinationBinName={null} />),
    ).toBe("");
  });

  it("leaves a mass out rather than captioning it as recorded", () => {
    const rendered = text(<ProcessFlowPreview {...run} biocharKg={null} biocharMoisturePercent={null} biocharDryKg={null} />);

    expect(rendered).toContain("Biochar out");
    expect(rendered).not.toContain("Not recorded wet");
    expect(rendered).not.toContain("yield");
  });
});
