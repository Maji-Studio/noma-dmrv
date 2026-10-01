import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// The real InfoHint mounts a floating-ui tooltip, which reads `window` on mount,
// and this suite runs in the node environment. The hint is covered by the
// tooltip tests; here it is inert.
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { children: ReactNode; label: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
import { ProductCompositionPreview } from "./product-composition-preview";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

describe("ProductCompositionPreview", () => {
  it("draws dry biochar against the rest of the wet product when the parts are unknown", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={4_000}
        dryBiocharKg={1_800}
        moisturePercent={40}
        testId="composition-under-test"
      />,
    );

    expect(html).toContain('data-testid="composition-under-test"');
    expect(html).toContain('data-segment="dry-biochar"');
    expect(html).toContain('data-segment="existing-water"');
    expect(text(html)).toContain("Product composition");
    expect(text(html)).toContain("Dry biochar 1,800 kg");
    expect(text(html)).toContain("Ingredients + water 2,200 kg");
    expect(text(html)).toContain("Measured moisture: 40%");
    expect(text(html)).toContain(
      "Wet biochar product is the sum of its parts: 1,800 kg + 2,200 kg = 4,000 kg.",
    );
  });

  it("gives every recorded ingredient its own part, with the biochar water beside them", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={1_100}
        dryBiocharKg={450}
        ingredients={[{ label: "Chicken manure", massKg: 550 }]}
        addedWaterKg={50}
      />,
    );

    expect(text(html)).toContain("Dry biochar 450 kg");
    expect(text(html)).toContain("Chicken manure 550 kg");
    expect(text(html)).toContain("Water in biochar 50 kg");
    expect(text(html)).toContain("Water added 50 kg");
    expect(html).toContain('data-segment="added-water"');
  });

  it("falls back to one remainder while an ingredient mass is still blank", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={1_100}
        dryBiocharKg={450}
        ingredients={[
          { label: "Chicken manure", massKg: 550 },
          { label: "Rock dust", massKg: null },
        ]}
      />,
    );

    expect(text(html)).toContain("Ingredients + water 650 kg");
    expect(text(html)).not.toContain("Rock dust");
  });

  it("names the next action instead of drawing a product it cannot resolve", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview wetMassKg={null} dryBiocharKg={450} />,
    );

    expect(text(html)).toContain("Record the masses above to see the product composition.");
    expect(html).not.toContain('role="img"');
  });

  it("splits each ingredient into solids and pools every water", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={1_100}
        components={[
          { label: "Dry biochar", massKg: 600, kind: "biochar" },
          { label: "Compost solids", massKg: 190, kind: "ingredient" },
          { label: "Water", massKg: 150, kind: "water" },
          { label: "Water added", massKg: 160, kind: "addedWater" },
        ]}
      />,
    );

    expect(text(html)).toContain("Dry biochar 600 kg");
    expect(text(html)).toContain("Compost solids 190 kg");
    expect(text(html)).toContain("Water 150 kg");
    expect(text(html)).toContain("Water added 160 kg");
    expect(html).toContain('data-segment="ingredient-solids"');
    expect(text(html)).toContain(
      "Wet biochar product is the sum of its parts: 600 kg + 190 kg + 150 kg + 160 kg = 1,100 kg.",
    );
  });

  it("names a missing part as not available and draws no proportions", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={1_100}
        components={[
          { label: "Dry biochar", massKg: 600, kind: "biochar" },
          { label: "Compost solids", massKg: null, kind: "ingredient" },
          { label: "Water", massKg: null, kind: "water" },
          { label: "Water added", massKg: 160, kind: "addedWater" },
        ]}
      />,
    );

    expect(text(html)).toContain("Dry biochar 600 kg");
    expect(text(html)).toContain("Compost solids Not available");
    expect(html).not.toContain('role="img"');
    expect(text(html)).not.toContain("sum of its parts");
  });

  it("leaves zero added water out of the parts", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={100}
        components={[
          { label: "Dry biochar", massKg: 90, kind: "biochar" },
          { label: "Water", massKg: 10, kind: "water" },
          { label: "Water added", massKg: 0, kind: "addedWater" },
        ]}
      />,
    );

    expect(text(html)).toContain("Dry biochar 90 kg");
    expect(text(html)).not.toContain("Water added");
  });

  it("asks for the masses while no part is known", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={null}
        components={[
          { label: "Dry biochar", massKg: null, kind: "biochar" },
          { label: "Water", massKg: null, kind: "water" },
        ]}
      />,
    );

    expect(text(html)).toContain("Record the masses above to see the product composition.");
  });

  it("puts the block's own actions in its action row", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={100}
        dryBiocharKg={60}
        actions={<button type="button">Stock history</button>}
      />,
    );

    expect(text(html)).toContain("Stock history");
  });

  it("takes a headline, a mass formatter and a basis line for a saved record", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        wetMassKg={100.125}
        components={[
          { label: "Dry biochar", massKg: 90, kind: "biochar" },
          { label: "Water", massKg: 10.125, kind: "water" },
        ]}
        formatMass={(mass) => (mass === null ? "Not available" : `${mass.toFixed(3)} kg`)}
        headline={<span>Saved total</span>}
        basis={<p>Saved with the product.</p>}
      />,
    );

    expect(text(html)).toContain("Saved total");
    expect(text(html)).toContain("Water 10.125 kg");
    expect(text(html)).toContain(
      "Wet biochar product is the sum of its parts: 90.000 kg + 10.125 kg = 100.125 kg.",
    );
    expect(text(html)).toContain("Saved with the product.");
  });

  describe("mass flow", () => {
    const biochar = { label: "Biochar", parts: [
      { label: "Dry biochar", massKg: 270, kind: "biochar" as const },
      { label: "Water in biochar", massKg: 30, kind: "water" as const },
    ] };
    const manure = { label: "Chicken manure", parts: [
      { label: "Chicken manure solids", massKg: 210, kind: "ingredient" as const },
      { label: "Water in chicken manure", massKg: 90, kind: "water" as const },
    ] };
    const noWater = { label: "Water added", parts: [{ label: "Water added", massKg: 0, kind: "addedWater" as const }] };
    const components = [
      { label: "Dry biochar", massKg: 270, kind: "biochar" as const },
      { label: "Chicken manure solids", massKg: 210, kind: "ingredient" as const },
      { label: "Water", massKg: 120, kind: "water" as const },
      { label: "Water added", massKg: 0, kind: "addedWater" as const },
    ];

    it("draws each input flowing into the product in place of the bar, and names every part beside the product with its share", () => {
      const html = renderToStaticMarkup(
        <ProductCompositionPreview wetMassKg={600} components={components} sources={[biochar, manure, noWater]} />,
      );

      expect(html).toContain("data-mass-flow");
      expect(html).not.toContain('data-segment="dry-biochar"');
      expect(text(html)).toContain("Biochar300 kg wet");
      expect(text(html)).toContain("Chicken manure300 kg wet");
      expect(text(html)).toContain("Wet biochar product600 kg");
      // No water was added, so it is not an input.
      expect(text(html)).not.toContain("Water added0 kg");
      // Regrouped by kind: the biochar's water and the manure's pool as one part.
      expect(text(html)).toContain("Dry biochar270 kg (45%)");
      expect(text(html)).toContain("Chicken manure solids210 kg (35%)");
      expect(text(html)).toContain("Water120 kg (20%)");
      // The parts are named in the flow, so no key repeats them.
      expect(text(html)).not.toContain("Dry biochar 270 kg");
    });

    it("keeps the bar while any part of an input is unknown", () => {
      const unknown = { ...manure, parts: [manure.parts[0], { ...manure.parts[1], massKg: null }] };
      const html = renderToStaticMarkup(
        <ProductCompositionPreview wetMassKg={600} components={components} sources={[biochar, unknown, noWater]} />,
      );

      expect(html).not.toContain("data-mass-flow");
      expect(html).toContain('data-segment="dry-biochar"');
    });
  });
});
