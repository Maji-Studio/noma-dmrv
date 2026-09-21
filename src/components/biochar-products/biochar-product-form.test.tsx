import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UseFormRegisterReturn } from "react-hook-form";
import {
  BiocharSourceMassFields,
  prepareBiocharProductSubmission,
} from "./biochar-product-form";
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
