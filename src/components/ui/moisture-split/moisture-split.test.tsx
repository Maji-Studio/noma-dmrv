import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoistureSplit } from "./moisture-split";

describe("MoistureSplit", () => {
  it("uses authoritative wet and dry masses even when moisture is absent", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={850}
        dryMassKg={820}
        moisturePercent={null}
        variant="inline"
      />,
    );

    expect(html).toContain("Wet: 850kg | Dry: 820kg");
    expect(html).not.toContain("not recorded");
  });

  it("uses authoritative dry mass for the accessible split description", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={100}
        dryMassKg={80}
        moisturePercent={5}
      />,
    );

    expect(html).toContain("100 kg wet: 80 kg dry mass and 20 kg water");
    expect(html).toContain("20% moisture");
  });

  it("keeps the wet and dry figures together above the bar", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={3000}
        moisturePercent={18}
        materialLabel="Feedstock"
      />,
    );

    const figuresIndex = html.indexOf(
      "Wet feedstock: 3,000kg | Dry feedstock: 2,460kg",
    );
    const barIndex = html.indexOf('role="img"');

    expect(figuresIndex).toBeGreaterThanOrEqual(0);
    expect(barIndex).toBeGreaterThan(figuresIndex);
    expect(html).not.toContain("Feedstock dry mass");
  });

  it("names biochar in the resolved figure line", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={850}
        moisturePercent={2}
        materialLabel="Biochar"
      />,
    );

    expect(html).toContain(
      "Wet biochar: 850kg | Dry biochar: 833kg",
    );
  });

});
