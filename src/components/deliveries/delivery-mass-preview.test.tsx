import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeliveryMassPreview } from "./delivery-mass-preview";

const PERSISTED_WET_MASS_KG = 2_500;
const PERSISTED_DRY_MASS_KG = 1_970;

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

  // DR-002 / DL-26-001 regression: the read drawer shows the stored 1,970 kg
  // dry, so an unchanged edit form must not flip to "Not recorded" just
  // because a sibling delivery poisoned the live allocation aggregate.
  it("falls back to the stored dry mass when the live allocation is unavailable", () => {
    const html = renderToStaticMarkup(
      <DeliveryMassPreview
        deliveredWetMassKg="2500"
        allocationWetBasisKg={null}
        allocationDryBasisKg={null}
        moisturePercent="20"
        persisted={{
          deliveredWetMassKg: PERSISTED_WET_MASS_KG,
          massDryKg: PERSISTED_DRY_MASS_KG,
        }}
      />,
    );

    expect(html).toContain("1,970 kg");
  });

  it("drops the stored fallback once the wet mass is edited", () => {
    const html = renderToStaticMarkup(
      <DeliveryMassPreview
        deliveredWetMassKg="3000"
        allocationWetBasisKg={null}
        allocationDryBasisKg={null}
        moisturePercent="20"
        persisted={{
          deliveredWetMassKg: PERSISTED_WET_MASS_KG,
          massDryKg: PERSISTED_DRY_MASS_KG,
        }}
      />,
    );

    expect(html).not.toContain("1,970");
  });
});
