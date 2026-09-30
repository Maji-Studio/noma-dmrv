import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SegmentBar, SegmentKey, batchAccentFill, segmentWidths } from "./segment-bar";
import type { MassSegment } from "@/components/forms/composition-ledger";

const shares: MassSegment[] = [
  { label: "Biochar", mass: 60, category: "dry-biochar" },
  { label: "Compost", mass: 30, category: "ingredient-solids", fill: batchAccentFill(0) },
  { label: "Rock dust", mass: 10, category: "ingredient-solids", fill: batchAccentFill(1) },
];
const percent = (share: number | null) => `${share ?? 0}%`;

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

describe("SegmentBar", () => {
  it("reads quantities in kilograms unless a formatter says otherwise", () => {
    const masses: MassSegment[] = [
      { label: "Dry biochar", mass: 800, category: "dry-biochar" },
      { label: "Water", mass: 200, category: "existing-water" },
    ];

    expect(renderToStaticMarkup(<SegmentBar segments={masses} label="Wet product" />)).toContain(
      'aria-label="Wet product: Dry biochar 800 kg, Water 200 kg"',
    );
    expect(
      renderToStaticMarkup(<SegmentBar segments={shares} label="Blend by volume" format={percent} />),
    ).toContain('aria-label="Blend by volume: Biochar 60%, Compost 30%, Rock dust 10%"');
  });

  it("keeps the key line in bar order with the same formatter", () => {
    const html = renderToStaticMarkup(<SegmentKey segments={shares} format={percent} />);

    expect(text(html)).toBe("Biochar 60%Compost 30%Rock dust 10%");
  });

  it("scales the parts to the bar", () => {
    expect(segmentWidths(shares)).toEqual([60, 30, 10]);
  });
});
