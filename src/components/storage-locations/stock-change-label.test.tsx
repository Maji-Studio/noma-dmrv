import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StockChangeLabel } from "./stock-change-label";
import type { AffectedStockPreview } from "@/types/output-stock";

describe("StockChangeLabel", () => {
  const preview = { removedWetKg: 100, blockingMessage: null } as AffectedStockPreview;

  it("distinguishes wet draws and additions", () => {
    const source = renderToStaticMarkup(<StockChangeLabel name="Source bin" preview={preview} available />);
    expect(source).toContain("Source bin");
    expect(source).toContain("−100 kg wet");
    expect(source).toContain("--st-wait");
    const destination = renderToStaticMarkup(<StockChangeLabel name="Product bin" preview={{ ...preview, removedWetKg: -400 }} available />);
    expect(destination).toContain("+400 kg wet");
    expect(destination).toContain("--st-ok");
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, 0])("does not advertise invalid mass %s", mass => {
    const html = renderToStaticMarkup(<StockChangeLabel name="Source bin" preview={{ ...preview, removedWetKg: mass }} available />);
    expect(html).toContain("Source bin");
    expect(html).not.toContain("kg wet");
  });

  it("hides stale and blocked projections", () => {
    expect(renderToStaticMarkup(<StockChangeLabel name="Source bin" preview={preview} available={false} />)).not.toContain("kg wet");
    expect(renderToStaticMarkup(<StockChangeLabel name="Source bin" preview={{ ...preview, blockingMessage: "Insufficient stock" }} available />)).not.toContain("kg wet");
    expect(renderToStaticMarkup(<StockChangeLabel name="Source bin" available />)).not.toContain("kg wet");
  });
});
