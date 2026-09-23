import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormDetailProvider } from "@/components/forms/form-detail-context";
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

/** The calculation table is the one thing the detail level gates. */
const TABLE_HEADER = "% of total";

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

  it("explains a stored dry mass as a subtraction rather than a moisture formula", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit wetMassKg={850} dryMassKg={820} moisturePercent={null} />,
    );

    expect(html).toContain(
      "Dry mass comes from the saved record. Water is the wet mass minus the dry mass: 850 kg - 820 kg = 30 kg.",
    );
    expect(html).not.toContain("Dry = wet");
  });

  it("puts the key line under the bar and names each segment with its mass", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={3000}
        moisturePercent={18}
        materialLabel="Feedstock"
      />,
    );

    const barIndex = html.indexOf('role="img"');
    const keyIndex = html.indexOf("Dry feedstock 2,460 kg");

    expect(barIndex).toBeGreaterThanOrEqual(0);
    expect(keyIndex).toBeGreaterThan(barIndex);
    expect(html).toContain("Water 540 kg");
    // No card, no frame: the bar belongs to the inputs above it.
    expect(html).not.toContain("Feedstock composition</span>");
    expect(html).not.toContain("Show calculation");
  });

  it("names biochar in the key line", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={850}
        moisturePercent={2}
        materialLabel="Biochar"
      />,
    );

    expect(html).toContain("Dry biochar 833 kg");
    expect(html).toContain("Water 17 kg");
  });

  it("combines the ledger and the wet-basis arithmetic in the calculation table", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={4000}
        moisturePercent={20}
        materialLabel="Feedstock"
      />,
    );

    expect(html).toContain("Feedstock composition.");
    expect(html).toContain("Wet total");
    expect(html).toContain(TABLE_HEADER);
    expect(html).toContain(
      "Dry = wet × (1 - moisture). 4,000 kg × (1 - 20%) = 3,200 kg.",
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

    expect(html).toContain('data-moisture-segment="dry"');
    expect(html).toContain('data-moisture-segment="water"');
    expect(html).toContain('data-moisture-segment="added-water"');
    expect(html).toContain(
      'aria-label="500 kg final wet mass: 405 kg dry mass, 45 kg water before addition, and 50 kg added water at 19% moisture."',
    );
    expect(html).toContain("Dry biochar 405 kg");
    expect(html).toContain("Water before addition 45 kg");
    expect(html).toContain("Water added 50 kg");
    expect(html).toContain("Final moisture 19%");
    expect(html).toContain(
      "Added water raises the wet mass and leaves dry mass unchanged: 450 kg + 50 kg = 500 kg.",
    );
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

    expect(html).toContain(
      '<p class="body-caption">Moisture from delivery record</p>',
    );
    expect(html).toContain("Water added 50 kg");
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

    expect(html).toContain("Dry biochar 405 kg");
    expect(html).not.toContain('data-moisture-segment="added-water"');
    expect(html).not.toContain("Final moisture");
  });

  it("names the missing input instead of drawing a split", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={3000}
        moisturePercent={null}
        materialLabel="Feedstock"
      />,
    );

    expect(html).toContain("border-dashed");
    expect(html).toContain(
      "Moisture not recorded. Feedstock dry mass cannot be calculated.",
    );
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain(TABLE_HEADER);
  });

  it("keeps the bar and key in Simple and adds the calculation table in Detailed", () => {
    const simple = renderToStaticMarkup(
      <FormDetailProvider scope="feedstock">
        <MoistureSplit
          wetMassKg={4000}
          moisturePercent={20}
          materialLabel="Feedstock"
        />
      </FormDetailProvider>,
    );

    expect(simple).toContain('role="img"');
    expect(simple).toContain("Dry feedstock 3,200 kg");
    expect(simple).toContain("Water 800 kg");
    expect(simple).not.toContain(TABLE_HEADER);
    expect(simple).not.toContain("Dry = wet");

    // No provider means no managed detail level, so read surfaces stay expanded.
    const detailed = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={4000}
        moisturePercent={20}
        materialLabel="Feedstock"
      />,
    );

    expect(detailed).toContain("Dry feedstock 3,200 kg");
    expect(detailed).toContain(TABLE_HEADER);
    expect(detailed).toContain(
      "Dry = wet × (1 - moisture). 4,000 kg × (1 - 20%) = 3,200 kg.",
    );
  });
});
