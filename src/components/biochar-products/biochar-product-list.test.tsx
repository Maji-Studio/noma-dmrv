import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { BiocharProductPageMassSummary } from "./biochar-product-list";

function productMass(
  massKg: number,
  moistureContentPercent: number | null,
  composition?: Record<string, unknown>,
  waterAddedKg: number | null = null,
): BiocharProductWithRelations {
  return {
    massKg,
    moistureContentPercent,
    waterAddedKg,
    composition,
  } as BiocharProductWithRelations;
}

describe("BiocharProductPageMassSummary", () => {
  it("keeps an incomplete paginated dry-mass total explicit", () => {
    const html = renderToStaticMarkup(
      <BiocharProductPageMassSummary
        products={[
          productMass(100, 10),
          productMass(50, null),
        ]}
      />,
    );

    expect(html).toContain("Mass on This Page");
    expect(html).toContain("Combined product mass on the current page");
    expect(html).toContain("150 kg");
    expect(html).toContain(MISSING_VALUE.notRecorded);
    expect(html).not.toContain("90 kg");
  });

  it("reports source dry biochar instead of drying the whole blend", () => {
    const html = renderToStaticMarkup(
      <BiocharProductPageMassSummary
        products={[
          productMass(
            500,
            10,
            {
              ingredients: [
                {
                  formulationIngredientId: "ingredient-1",
                  feedstockTypeId: "feedstock-type-1",
                  feedstockTypeName: "Chicken manure",
                  feedstockTypeCategory: "manure",
                  ratio: 0.5,
                  massKg: 500,
                  storageLocationId: null,
                },
              ],
            },
            50,
          ),
        ]}
      />,
    );

    expect(html).toContain("Wet product");
    expect(html).toContain("550 kg");
    expect(html).toContain("Dry biochar");
    expect(html).toContain("0 kg");
  });
});
