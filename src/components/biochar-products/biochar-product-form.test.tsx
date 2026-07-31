import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransferFlowPreview } from "./biochar-product-form";

describe("TransferFlowPreview", () => {
  it("summarizes dry stock, transfer, and remainder without duplicating the transfer", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableDryMassKg={495}
        sourceWetMassKg={495}
        sourceMoisturePercent={10}
        destinationDryMassKg={445.5}
        destinationBinLabel={null}
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Source · Biochar July");
    expect(text).toContain("Dry biochar: 495 kg (−445.5 kg)");
    expect(text).toContain("Remaining: 49.5 kg");
    expect(html).toContain(
      'Remaining: <span class="font-medium">49.5 kg</span>',
    );
    expect(text.match(/445\.5 kg/g)).toHaveLength(1);
    expect(text).not.toContain("Dry biochar transferred");
    expect(text).not.toContain("Dry: Not recorded");
  });

  it("waits for moisture before claiming a dry transfer or remainder", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableDryMassKg={495}
        sourceWetMassKg={495}
        sourceMoisturePercent={null}
        destinationDryMassKg={null}
        destinationBinLabel={null}
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Dry biochar: 495 kg");
    expect(text).toContain("Add wet mass and moisture to calculate the transfer.");
    expect(text).not.toContain("Remaining:");
  });

  it("uses the compact hierarchy when the destination is selected", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableDryMassKg={495}
        sourceWetMassKg={495}
        sourceMoisturePercent={10}
        destinationDryMassKg={445.5}
        destinationBinLabel="Product July"
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Destination · Product July");
    expect(text).toContain("Dry product: +445.5 kg");
    expect(text).not.toContain("Dry product received");
  });
});
