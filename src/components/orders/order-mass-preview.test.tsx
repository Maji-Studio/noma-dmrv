import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderMassPreview } from "./order-mass-preview";

describe("OrderMassPreview", () => {
  it("shows the proportional tracked dry biochar as a planning estimate", () => {
    const html = renderToStaticMarkup(
      <OrderMassPreview
        quantityKg="1000"
        productWetBasisKg={4_000}
        productDryBiocharKg={1_800}
      />,
    );

    expect(html).toContain("Wet biochar product reserved:");
    expect(html).toContain("1,000 kg");
    expect(html).toContain("Dry biochar");
    expect(html).toContain("450 kg");
    expect(html).toContain("planning estimate");
    expect(html).toContain("bg-[var(--color-background-medium)]");
  });

  it("keeps the unresolved visualization when inputs are incomplete", () => {
    const html = renderToStaticMarkup(
      <OrderMassPreview
        quantityKg=""
        productWetBasisKg={4_000}
        productDryBiocharKg={1_800}
      />,
    );

    expect(html).toContain("Not recorded");
  });

  it("does not use finished-product moisture to estimate dry biochar", () => {
    const html = renderToStaticMarkup(
      <OrderMassPreview
        quantityKg="100"
        productWetBasisKg={150}
        productDryBiocharKg={90}
      />,
    );

    expect(html).toContain("60 kg");
    expect(html).not.toContain("90 kg");
  });
});
