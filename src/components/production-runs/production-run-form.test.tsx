import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProcessFlowPreview } from "./production-run-process-flow-preview";

describe("ProcessFlowPreview", () => {
  it("uses the compact dry-first hierarchy across the process flow", () => {
    const html = renderToStaticMarkup(
      <ProcessFlowPreview
        sourceBinName="Feedstock July"
        feedstockKg={100}
        feedstockDryKg={90}
        reactorName="Reactor 1"
        biocharKg={50}
        biocharDryKg={45}
        destinationBinName="Biochar July"
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Input · Feedstock July");
    expect(text).toContain("Dry feedstock: 90 kg");
    expect(text).toContain("ReactorReactor 1Dry yield: 50.0%");
    expect(text).toContain("Output · Biochar July");
    expect(text).toContain("Dry biochar: 45 kg");
    expect(text).not.toContain("100 kg wet");
    expect(text).not.toContain("50 kg wet");
  });
});
