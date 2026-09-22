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

  it("keeps the compact readout to the total, the bar and one key line", () => {
    const html = renderToStaticMarkup(
      <ProductCompositionPreview
        variant="compact"
        wetMassKg={1_100}
        dryBiocharKg={450}
        wetLabel="Final wet biochar product"
      />,
    );

    expect(text(html)).toContain("Final wet biochar product: 1,100 kg");
    expect(text(html)).toContain("Dry biochar 450 kg");
    expect(text(html)).not.toContain("Show calculation");
    expect(text(html)).not.toContain("% of total");
  });
});
