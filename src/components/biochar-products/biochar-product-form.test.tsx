import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransferFlowPreview } from "./biochar-product-form";

describe("TransferFlowPreview", () => {
  it("derives the source dry draw from source stock rather than product moisture", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableWetMassKg={500}
        sourceAvailableDryMassKg={400}
        sourceWetMassKg={100}
        destinationDryMassKg={90}
        destinationBinLabel="Product July"
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Source · Biochar July");
    expect(text).toContain("Dry biochar: 400 kg (−80 kg)");
    expect(text).toContain("Remaining: 320 kg");
    expect(text).toContain("Dry product: +90 kg");
    expect(text).not.toContain("(−90 kg)");
  });

  it("adds the fixed allocation back before showing an edit remainder", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableWetMassKg={100}
        sourceAvailableDryMassKg={80}
        sourceWetMassKg={50}
        destinationDryMassKg={45}
        destinationBinLabel={null}
        isEditMode
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Dry biochar: 120 kg (−40 kg)");
    expect(text).toContain("Remaining: 80 kg");
  });

  it("names unavailable source dry stock instead of asking for entered fields", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableWetMassKg={500}
        sourceAvailableDryMassKg={null}
        sourceWetMassKg={100}
        destinationDryMassKg={90}
        destinationBinLabel={null}
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain(
      "Source dry stock is not available. Reconcile the storage bin.",
    );
    expect(text).not.toContain("Add wet mass");
    expect(text).not.toContain("Remaining:");
  });

  it("keeps a visible preview while the operator has entered only wet mass", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName={null}
        sourceAvailableWetMassKg={null}
        sourceAvailableDryMassKg={null}
        sourceWetMassKg={100}
        destinationDryMassKg={null}
        destinationBinLabel={null}
      />,
    );

    expect(html).toContain("Select a biochar bin");
    expect(html).toContain("Select a bin");
  });

  it("names missing product moisture when the destination dry mass is unresolved", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableWetMassKg={500}
        sourceAvailableDryMassKg={400}
        sourceWetMassKg={100}
        destinationDryMassKg={null}
        destinationBinLabel="Product July"
      />,
    );

    expect(html).toContain("Record moisture to calculate the dry product.");
  });
});
