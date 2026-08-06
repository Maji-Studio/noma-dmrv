import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeliveryMassPreview } from "./delivery-mass-preview";

describe("DeliveryMassPreview", () => {
  it("parses watched moisture strings for the measured moisture preview", () => {
    const html = renderToStaticMarkup(
      <DeliveryMassPreview
        deliveredWetMassKg="1000"
        allocationWetBasisKg={4_000}
        allocationDryBasisKg={1_800}
        moisturePercent="20"
      />,
    );

    expect(html).toContain('data-testid="delivery-mass-preview"');
    expect(html).toContain("Wet biochar product: <span");
    expect(html).toContain(">1,000 kg</span>");
    expect(html).toContain("450 kg");
    expect(html).toContain("Measured product moisture: 20%");
    expect(html).not.toContain("Measured product moisture: Not recorded");
  });
});
