import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MethodPill } from "./method-pill";

describe("MethodPill semantic state treatment", () => {
  it.each([
    ["method_a", "neutral", "Method A"],
    ["method_b", "in-progress", "Method B"],
  ] as const)("renders %s through the %s state", (method, state, label) => {
    const html = renderToStaticMarkup(<MethodPill method={method} />);

    expect(html).toContain(`data-status="${method}"`);
    expect(html).toContain(`data-status-state="${state}"`);
    expect(html).toContain(label);
  });
});
