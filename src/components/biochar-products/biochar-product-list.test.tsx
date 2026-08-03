import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { BiocharProductPageMassSummary } from "./biochar-product-list";

function productMass(
  massKg: number,
  moistureContentPercent: number | null,
): BiocharProductWithRelations {
  return {
    massKg,
    moistureContentPercent,
    waterAddedKg: null,
  } as BiocharProductWithRelations;
}

describe("BiocharProductPageMassSummary", () => {
  it("labels the paginated total and keeps incomplete dry mass explicit", () => {
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
    expect(html).toContain("Not recorded");
  });
});
