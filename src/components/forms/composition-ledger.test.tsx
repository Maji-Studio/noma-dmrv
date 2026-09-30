import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompositionLedger } from "./composition-ledger";

function ledger(total: number | null, dry: number | null, water: number | null) {
  return renderToStaticMarkup(<CompositionLedger label="Composition" totalLabel="Wet total" total={total} segments={[{ label: "Dry", mass: dry, category: "dry-biochar" }, { label: "Water", mass: water, category: "existing-water" }]} />);
}
function hideZeroLedger(segments: { label: string; mass: number | null }[]) {
  return renderToStaticMarkup(<CompositionLedger hideZero label="Composition" totalLabel="Dry biochar" total={segments.reduce((sum, segment) => sum + (segment.mass ?? 0), 0)} segments={segments.map(segment => ({ ...segment, category: "dry-batch" }))} />);
}

describe("composition ledger", () => {
  it("drops zero-mass segments but keeps them when nothing carries mass", () => {
    const mixed = hideZeroLedger([{ label: "Batch A", mass: 40 }, { label: "Batch B", mass: 0 }]);
    expect(mixed).toContain("Batch A");
    expect(mixed).not.toContain("Batch B");
    const empty = hideZeroLedger([{ label: "Batch A", mass: 0 }, { label: "Batch B", mass: 0 }]);
    expect(empty).toContain("Batch A");
    expect(empty).toContain("Batch B");
  });

  it("uses the same total for each quiet mass/share row", () => {
    const html = ledger(100, 80, 20);
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('width:80%');
    expect(html).toContain('width:20%');
    expect(html).toContain("80 kg");
  });
  it.each([[null, 80, 20], [100, null, 20], [0, 0, 0], [100, 120, 0], [100, 40, 20], [100, NaN, 20]])("omits bars and shares for incomplete or zero basis %s/%s/%s", (total, dry, water) => {
    const html = ledger(total, dry, water);
    expect(html).not.toContain("width:");
    expect(html).not.toContain("100%");
    expect(html).toContain("Not available");
  });
});
