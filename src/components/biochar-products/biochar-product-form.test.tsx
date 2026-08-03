import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UseFormRegisterReturn } from "react-hook-form";
import {
  BiocharBlendMassFields,
  prepareBiocharProductSubmission,
  TransferFlowPreview,
} from "./biochar-product-form";
import type { BiocharProductFormData } from "@/schemas/biochar-products";

const registration = (name: string): UseFormRegisterReturn => ({
  name,
  onBlur: async () => undefined,
  onChange: async () => undefined,
  ref: () => undefined,
});

describe("BiocharBlendMassFields", () => {
  it("labels the total blend wet mass and keeps the ingredient scope visible", () => {
    const html = renderToStaticMarkup(
      <BiocharBlendMassFields
        wetMassKg={100}
        moisturePercent={10}
        materialLabel="Biochar"
        wet={{
          id: "massKg",
          registration: registration("massKg"),
        }}
        moisture={{
          id: "moistureContentPercent",
          registration: registration("moistureContentPercent"),
        }}
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Blend wet mass (kg)");
    expect(text).toContain("Includes all blend ingredients.");
    expect(text).not.toContain("Biochar wet mass");
  });
});

describe("prepareBiocharProductSubmission", () => {
  const ingredientBins = [
    {
      formulationIngredientId: "11111111-1111-4111-8111-111111111111",
      feedstockTypeId: "22222222-2222-4222-8222-222222222222",
      feedstockTypeName: "Compost",
      feedstockTypeCategory: "compost",
      massKg: 20,
      storageLocationId: "33333333-3333-4333-8333-333333333333",
    },
  ];
  const data = { ingredientBins } as BiocharProductFormData;

  it("omits immutable composition from a frozen allocation update", () => {
    expect(prepareBiocharProductSubmission(data, true).ingredientBins)
      .toBeUndefined();
  });

  it("keeps editable composition in the submission", () => {
    expect(prepareBiocharProductSubmission(data, false).ingredientBins)
      .toBe(ingredientBins);
  });
});

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

  it("uses the recorded edit allocation after the source ratio changes", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableWetMassKg={100}
        sourceAvailableDryMassKg={50}
        sourceWetMassKg={50}
        recordedSourceDryMassKg={40}
        destinationDryMassKg={45}
        destinationBinLabel={null}
        isEditMode
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Dry biochar: 90 kg (−40 kg)");
    expect(text).toContain("Remaining: 50 kg");
    expect(text).not.toContain("(−25 kg)");
  });

  it("reconstructs the recorded edit draw when the source bin is exhausted", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Biochar July"
        sourceAvailableWetMassKg={0}
        sourceAvailableDryMassKg={0}
        sourceWetMassKg={50}
        recordedSourceDryMassKg={40}
        destinationDryMassKg={45}
        destinationBinLabel={null}
        isEditMode
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Dry biochar: 40 kg (−40 kg)");
    expect(text).toContain("Remaining: 0 kg");
  });

  it("does not invent an edit draw when the recorded allocation is unavailable", () => {
    const html = renderToStaticMarkup(
      <TransferFlowPreview
        sourceBinName="Legacy biochar"
        sourceAvailableWetMassKg={100}
        sourceAvailableDryMassKg={50}
        sourceWetMassKg={50}
        recordedSourceDryMassKg={null}
        destinationDryMassKg={45}
        destinationBinLabel={null}
        isEditMode
      />,
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Recorded source dry allocation is not available.");
    expect(text).not.toContain("(−25 kg)");
    expect(text).not.toContain("Remaining:");
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
