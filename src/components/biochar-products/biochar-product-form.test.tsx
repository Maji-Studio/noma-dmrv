import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UseFormRegisterReturn } from "react-hook-form";
import {
  BiocharSourceMassFields,
  prepareBiocharProductSubmission,
  ProductCompositionBlock,
} from "./biochar-product-form";
import { FormDetailProvider } from "@/components/forms/form-detail-context";
import { formProductComposition } from "./form-product-composition";
import type { BiocharProductFormData } from "@/schemas/biochar-products";

const registration = (name: string): UseFormRegisterReturn => ({
  name,
  onBlur: async () => undefined,
  onChange: async () => undefined,
  ref: () => undefined,
});

describe("BiocharSourceMassFields", () => {
  it("labels the biochar-only wet mass drawn from the source bin", () => {
    const html = renderToStaticMarkup(
      <BiocharSourceMassFields
        wetMassKg={100}
        moisturePercent={10}
        addedWaterKg={10}
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

    expect(text).toContain("Biochar wet mass (kg)");
    expect(text).toContain("Wet biochar drawn from the source bin.");
    expect(text).toContain("Biochar + water final moisture");
    expect(text).not.toContain("Blend wet mass");
  });
});

describe("ProductCompositionBlock", () => {
  const composition = formProductComposition({
    isEditMode: false, massKg: 100, moisturePercent: 10, waterAddedKg: 0,
    recordedSourceDryMassKg: null, ingredients: [], allocationFrozen: false,
  });
  const block = (massKg: number | null, ingredientBins: Array<{ massKg?: unknown }> = []) => (
    <ProductCompositionBlock composition={composition} massKg={massKg} ingredientBins={ingredientBins} storageLocationId={null} facilityId="facility" />
  );
  // A provider starts in Simple; outside one the form reads as Detailed.
  const simple = (node: ReturnType<typeof block>) =>
    renderToStaticMarkup(<FormDetailProvider scope="form">{node}</FormDetailProvider>);

  it("stays out of Simple until the biochar or an ingredient has a mass", () => {
    expect(simple(block(null))).not.toContain("Product composition");
    expect(simple(block(null, [{ massKg: undefined }]))).not.toContain("Product composition");
  });

  it("draws in Simple once a mass is set", () => {
    expect(simple(block(100))).toContain("Product composition");
    expect(simple(block(null, [{ massKg: 20 }]))).toContain("Product composition");
  });

  it("always draws in Detailed", () => {
    expect(renderToStaticMarkup(block(null))).toContain("Product composition");
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
  const data = { massKg: 100, ingredientBins } as BiocharProductFormData;

  it("submits the blend total: entered biochar mass plus ingredient masses", () => {
    expect(prepareBiocharProductSubmission(data, false).massKg).toBe(120);
    expect(prepareBiocharProductSubmission(data, true).massKg).toBe(120);
  });

  it("keeps the entered mass when no ingredients are recorded", () => {
    const pure = { massKg: 100 } as BiocharProductFormData;
    expect(prepareBiocharProductSubmission(pure, false).massKg).toBe(100);
  });

  it("passes the stored blend total through verbatim on edit", () => {
    // Edit rows may be reconciled against a since-edited formulation, so the
    // stored total must never be rebuilt from them.
    expect(prepareBiocharProductSubmission(data, false, 90).massKg).toBe(90);
    expect(prepareBiocharProductSubmission(data, true, 90).massKg).toBe(90);
  });

  it("omits immutable composition from a frozen allocation update", () => {
    expect(prepareBiocharProductSubmission(data, true).ingredientBins)
      .toBeUndefined();
  });

  it("keeps editable composition in the submission", () => {
    expect(prepareBiocharProductSubmission(data, false).ingredientBins)
      .toBe(ingredientBins);
  });
});

describe("formProductComposition", () => {
  const base = {
    isEditMode: false,
    massKg: 100,
    moisturePercent: 10,
    waterAddedKg: 0,
    recordedSourceDryMassKg: null,
    ingredients: [],
    allocationFrozen: false,
  };
  const manure = {
    formulationIngredientId: "11111111-1111-4111-8111-111111111111",
    feedstockTypeId: "22222222-2222-4222-8222-222222222222",
    feedstockTypeName: "Chicken manure",
    feedstockTypeCategory: "manure",
    massKg: 550,
    moistureContentPercent: 20,
    storageLocationId: "33333333-3333-4333-8333-333333333333",
  };
  const part = (composition: ReturnType<typeof formProductComposition>, label: string) =>
    composition.components.find((component) => component.label === label)?.massKg;

  it("derives the dry draw from the entered biochar moisture", () => {
    const composition = formProductComposition(base);
    expect(composition.sourceDryKg).toBe(90);
    expect(part(composition, "Dry biochar")).toBe(90);
    expect(part(composition, "Water")).toBe(10);
    expect(composition.wetProductKg).toBe(100);
  });

  it("leaves the dry draw unresolved while moisture is missing", () => {
    const composition = formProductComposition({ ...base, moisturePercent: null });
    expect(composition.sourceDryKg).toBeNull();
    expect(part(composition, "Dry biochar")).toBeNull();
  });

  it("uses the recorded edit allocation instead of the entered moisture", () => {
    const composition = formProductComposition({
      ...base,
      isEditMode: true,
      massKg: 50,
      recordedSourceDryMassKg: 40,
    });
    expect(composition.sourceDryKg).toBe(40);
    expect(part(composition, "Water")).toBe(10);
  });

  it("falls back to the entered moisture on a legacy edit without a recorded allocation", () => {
    const composition = formProductComposition({ ...base, isEditMode: true, massKg: 50 });
    expect(composition.sourceDryKg).toBe(45);
  });

  it("stacks ingredients and added water on the biochar and splits each ingredient", () => {
    const composition = formProductComposition({
      ...base,
      massKg: 500,
      waterAddedKg: 50,
      ingredients: [manure],
    });
    expect(composition.wetProductKg).toBe(1_100);
    expect(part(composition, "Dry biochar")).toBe(450);
    expect(part(composition, "Chicken manure solids")).toBe(440);
    expect(part(composition, "Water")).toBe(160);
    expect(part(composition, "Water added")).toBe(50);
  });

  it("keeps the saved ingredient dry snapshot on a frozen allocation", () => {
    const composition = formProductComposition({
      ...base,
      isEditMode: true,
      recordedSourceDryMassKg: 90,
      allocationFrozen: true,
      ingredients: [{ ...manure, massDryKg: 500 }],
    });
    expect(part(composition, "Chicken manure solids")).toBe(500);
  });

  it("omits the wet product total while water or an ingredient mass is blank", () => {
    expect(formProductComposition({ ...base, waterAddedKg: null }).wetProductKg).toBeNull();
    expect(
      formProductComposition({ ...base, ingredients: [{ ...manure, massKg: null }] }).wetProductKg,
    ).toBeNull();
  });
});
