import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoistureSplit } from "./moisture-split";

type MoistureSegment = "dry" | "water" | "added-water";

function renderedSegmentWidth(html: string, segment: MoistureSegment): number {
  const match = html.match(
    new RegExp(
      `data-moisture-segment="${segment}"[^>]*style="width:([^%]+)%"`,
    ),
  );
  if (!match) throw new Error(`Missing rendered width for ${segment}`);
  return Number(match[1]);
}

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

  it("includes added water in the final wet mass and draws it separately", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={450}
        moisturePercent={10}
        addedWaterKg={50}
        materialLabel="Biochar"
      />,
    );

    expect(html).toContain(
      "Final wet biochar: 500kg | Dry biochar: 405kg",
    );
    expect(html).toContain('data-moisture-segment="dry"');
    expect(html).toContain('data-moisture-segment="water"');
    expect(html).toContain('data-moisture-segment="added-water"');
    expect(html).toContain(
      'aria-label="500 kg final wet mass: 405 kg dry mass, 45 kg water before addition, and 50 kg added water at 19% moisture."',
    );
    expect(html).toContain("Water before addition: 45 kg");
    expect(html).toContain("Water added: 50 kg");
    expect(html).toContain("Final moisture: 19%");
  });

  it("preserves a supplied note when added water is present", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={450}
        moisturePercent={10}
        addedWaterKg={50}
        note="Moisture from delivery record"
      />,
    );

    expect(html).toContain("Moisture from delivery record");
    expect(html).toContain("Water added: 50 kg");
  });

  it("keeps tiny visible segments while normalizing the bar to 100%", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={1000}
        moisturePercent={1}
        addedWaterKg={2}
      />,
    );

    const dryWidth = renderedSegmentWidth(html, "dry");
    const waterWidth = renderedSegmentWidth(html, "water");
    const addedWaterWidth = renderedSegmentWidth(html, "added-water");

    expect(dryWidth).toBe(97);
    expect(waterWidth).toBe(1.5);
    expect(addedWaterWidth).toBe(1.5);
    expect(dryWidth + waterWidth + addedWaterWidth).toBe(100);
  });

  it("keeps the existing two-part chart when no water is added", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={450}
        moisturePercent={10}
        addedWaterKg={0}
        materialLabel="Biochar"
      />,
    );

    expect(html).toContain(
      "Wet biochar: 450kg | Dry biochar: 405kg",
    );
    expect(html).not.toContain('data-moisture-segment="added-water"');
    expect(html).toContain("Moisture: 10% · Water: 45 kg");
  });
});
