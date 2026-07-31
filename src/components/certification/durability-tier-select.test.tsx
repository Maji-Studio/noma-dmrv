import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DurabilityTierSelect } from "./durability-tier-select";

describe("DurabilityTierSelect", () => {
  it("shows the unavailable 200-year tier beside the active tier on editable forms", () => {
    const html = renderToStaticMarkup(
      <DurabilityTierSelect
        value="1000_year"
        onChange={vi.fn()}
        aria-label="Facility durability tier"
      />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Facility durability tier"');
    expect(html).toContain("1000-year");
    expect(html).toContain("200-year");
    expect(html).toContain("Available later");
    expect(html).toContain(
      "Storage measured to a 200-year permanence standard.",
    );
    expect(html).toMatch(
      /role="radio"[^>]*aria-checked="false"[^>]*aria-disabled="true"/,
    );
  });

  it("keeps read-only surfaces focused on the active tier", () => {
    const html = renderToStaticMarkup(
      <DurabilityTierSelect value="1000_year" readOnly />,
    );

    expect(html).toContain('data-testid="durability-tier-info"');
    expect(html).toContain("1000-year");
    expect(html).not.toContain("200-year");
    expect(html).not.toContain('role="radiogroup"');
  });
});
