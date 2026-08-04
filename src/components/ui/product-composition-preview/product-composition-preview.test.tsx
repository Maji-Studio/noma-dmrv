import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductCompositionPreview } from "./product-composition-preview";

describe("ProductCompositionPreview", () => {
  it("shows exactly the conserved dry biochar and complementary product mass", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={4_000}
        dryBiocharKg={1_800}
        moisturePercent={40}
        testId="composition-under-test"
      />,
    );

    expect(html).toContain('data-testid="composition-under-test"');
    expect(html).toContain("Dry biochar");
    expect(html).toContain("1,800 kg");
    expect(html).toContain("Ingredients + water");
    expect(html).toContain("2,200 kg");
    expect(html).toContain("Measured product moisture: 40%");
    expect(html).toContain("This measurement does not change dry biochar.");
    expect(html).toContain('role="img"');
    expect(html).toContain('data-product-composition-segment="dry-biochar"');
    expect(html).toContain(
      'data-product-composition-segment="ingredients-water"',
    );
  });
});
