// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { MoistureSplit } from "./moisture-split";

afterEach(cleanup);

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

/** The ledger lives in the (i) panel and mounts only while it is open. */
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

    expect(html).toContain("100 kg wet mass: 80 kg dry mass and 20 kg water");
    expect(html).toContain("20% moisture");
  });

  it("keeps the stored dry mass sentence in the (i) panel and nothing inline", async () => {
    const element = <MoistureSplit wetMassKg={850} dryMassKg={820} moisturePercent={null} />;
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("Dry mass comes from the saved record");
    expect(html).not.toContain("Dry = wet");

    render(element);
    fireEvent.click(screen.getByRole("button", { name: "About Material composition" }));
    expect(await screen.findByText(
      "Dry mass comes from the saved record. Water is the wet mass minus the dry mass: 850 kg - 820 kg = 30 kg.",
    )).toBeTruthy();
  });

  it("puts the (i) inside the key row, after the last swatch item, so it wraps with the key", () => {
    const { container } = render(<MoistureSplit wetMassKg={450} moisturePercent={10} addedWaterKg={50} />);
    const key = container.querySelector('[aria-live="polite"]')!;
    expect(key.lastElementChild?.hasAttribute("data-explanation-info")).toBe(true);
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

  it("keeps the wet-basis formula inline and puts the ledger behind the (i)", async () => {
    const html = renderToStaticMarkup(
      <MoistureSplit
        wetMassKg={4000}
        moisturePercent={20}
        materialLabel="Feedstock"
      />,
    );

    expect(html).toContain(
      "Dry = wet × (1 - moisture). 4,000 kg × (1 - 20%) = 3,200 kg.",
    );
    expect(html).not.toContain(TABLE_HEADER);
    expect(html).not.toContain("Wet total");

    render(<MoistureSplit wetMassKg={4000} moisturePercent={20} materialLabel="Feedstock" />);
    expect(screen.queryByText(TABLE_HEADER)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Feedstock composition" }));
    expect(await screen.findByText(TABLE_HEADER)).toBeTruthy();
    expect(screen.getByText("Wet total")).toBeTruthy();
  });

  it("includes added water in the final wet mass and draws it separately", async () => {
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
    // Only the dry mass sentence stays inline; the added water step waits in the (i).
    expect(html).toContain("Dry = wet × (1 - moisture).");
    expect(html).not.toContain("Added water raises the wet mass");
    render(<MoistureSplit wetMassKg={450} moisturePercent={10} addedWaterKg={50} materialLabel="Biochar" />);
    fireEvent.click(screen.getByRole("button", { name: "About Biochar composition" }));
    expect(await screen.findByText(
      "Added water raises the wet mass and leaves dry mass unchanged: 450 kg + 50 kg = 500 kg.",
    )).toBeTruthy();
  });

  it("keeps a supplied note in the (i) panel when added water is present", async () => {
    render(
      <MoistureSplit
        wetMassKg={450}
        moisturePercent={10}
        addedWaterKg={50}
        note="Moisture from delivery record"
      />,
    );

    expect(screen.queryByText("Moisture from delivery record")).toBeNull();
    expect(screen.getByText(/Water added 50 kg/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About Material composition" }));
    expect(await screen.findByText("Moisture from delivery record")).toBeTruthy();
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

  it("draws no (i), formula or ledger when the host surface explains the arithmetic", () => {
    const html = renderToStaticMarkup(
      <MoistureSplit wetMassKg={4000} moisturePercent={20} materialLabel="Feedstock" calculation={false} />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain("Dry feedstock 3,200 kg");
    expect(html).not.toContain("data-explanation-info");
    expect(html).not.toContain("Dry = wet");
  });
});
