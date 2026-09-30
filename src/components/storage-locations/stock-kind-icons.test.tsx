import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StockKindIcon } from "./stock-kind-icons";

describe("StockKindIcon", () => {
  it("draws a decorative icon per kind and a fallback for unknown kinds", () => {
    const loss = renderToStaticMarkup(<StockKindIcon kind="loss" size={16} />);
    const count = renderToStaticMarkup(<StockKindIcon kind="count" size={16} />);
    const unknown = renderToStaticMarkup(<StockKindIcon kind="something_new" size={16} />);
    expect(loss).toContain('aria-hidden="true"');
    expect(loss).not.toBe(count);
    expect(unknown).toContain("<svg");
  });
});
