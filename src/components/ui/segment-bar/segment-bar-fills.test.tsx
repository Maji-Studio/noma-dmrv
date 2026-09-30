import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { MassSegment } from "@/components/forms/composition-ledger";
import { SegmentBar, SegmentKey, batchAccentFill, BATCH_ACCENT_FILLS } from "./segment-bar";

it("cycles the batch accents so a fourth batch reuses the first", () => {
  expect(BATCH_ACCENT_FILLS.map((_, index) => batchAccentFill(index))).toEqual([...BATCH_ACCENT_FILLS]);
  expect(batchAccentFill(3)).toBe(BATCH_ACCENT_FILLS[0]);
});

it("paints a segment and its swatch with the segment's own fill", () => {
  const segments: MassSegment[] = [
    { label: "B-001", mass: 60, category: "dry-batch", fill: "var(--acc-prod)" },
    { label: "B-002", mass: 40, category: "dry-batch", fill: "var(--acc-infra)" },
  ];
  const bar = renderToStaticMarkup(<SegmentBar label="Delivered dry biochar" segments={segments} />);
  expect(bar).toContain("background:var(--acc-prod)");
  expect(bar).toContain("background:var(--acc-infra)");
  const key = renderToStaticMarkup(<SegmentKey segments={segments} />);
  expect(key).toContain("background:var(--acc-infra)");
});

it("falls back to the category fill when a segment names none", () => {
  const segments: MassSegment[] = [
    { label: "Dry feedstock", mass: 60, category: "dry-biochar" },
    { label: "Water", mass: 40, category: "existing-water" },
  ];
  const bar = renderToStaticMarkup(<SegmentBar label="Feedstock delivery" segments={segments} />);
  expect(bar).toContain("moisture-water-hatch");
  expect(bar).not.toContain("background:");
});
