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

  it("renders and describes added water as a third segment", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={495}
        moisturePercent={15}
        addedWaterKg={50}
      />,
    );

    expect(html).toContain('data-moisture-segment="dry"');
    expect(html).toContain('data-moisture-segment="water"');
    expect(html).toContain('data-moisture-segment="added-water"');
    expect(html).toContain("bg-[var(--color-moisture-added-water)]");
    expect(html).toContain(
      "545 kg final wet mass: 420.8 kg dry mass, 74.3 kg water already present, and 50 kg added water at 22.8% moisture.",
    );
    expect(html).toContain("495 kg → 545 kg after adding 50 kg water");
    expect(html).toContain("Moisture: 15% → 22.8%");
  });

  it("preserves the two-segment bar and default note when added water is zero", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={495}
        moisturePercent={15}
        addedWaterKg={0}
      />,
    );

    expect(html).not.toContain('data-moisture-segment="added-water"');
    expect(html).not.toContain("after adding");
    expect(html).not.toContain("→");
    expect(html).toContain("495 kg wet: 420.8 kg dry mass and 74.3 kg water");
    expect(html).toContain("Moisture: 15% · Water: 74.3 kg");
  });

  it.each([
    ["blank", null],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("does not show the added-water state for a %s value", (_, addedWaterKg) => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={495}
        moisturePercent={15}
        addedWaterKg={addedWaterKg}
      />,
    );

    expect(html).not.toContain('data-moisture-segment="added-water"');
    expect(html).not.toContain("after adding");
    expect(html).not.toContain("→");
  });
});
