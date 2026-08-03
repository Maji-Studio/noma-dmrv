import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deriveEffectiveMoisturePercent } from "@/lib/mass-moisture";
import { OrderMassPreview } from "./order-mass-preview";

describe("OrderMassPreview", () => {
  it("derives dry mass from the entered wet quantity and selected product moisture", () => {
    const html = renderToStaticMarkup(
      <OrderMassPreview quantityKg="1000" moisturePercent={15} />,
    );

    expect(html).toContain(
      "Wet biochar product: 1,000kg | Dry biochar: 850kg",
    );
    expect(html).toContain('data-testid="order-mass-preview"');
    expect(html).toContain("bg-[var(--color-background-medium)]");
  });

  it("keeps the unresolved visualization when inputs are incomplete", () => {
    const html = renderToStaticMarkup(
      <OrderMassPreview quantityKg="" moisturePercent={15} />,
    );

    expect(html).toContain("Wet mass not recorded");
    expect(html).toContain("Dry biochar cannot be calculated");
  });

  it("previews dry mass from effective moisture after added water", () => {
    const html = renderToStaticMarkup(
      <OrderMassPreview
        quantityKg="100"
        moisturePercent={deriveEffectiveMoisturePercent(100, 10, 50)}
      />,
    );

    expect(html).toContain(
      "Wet biochar product: 100kg | Dry biochar: 60kg",
    );
    expect(html).not.toContain("Dry biochar: 90kg");
  });
});
