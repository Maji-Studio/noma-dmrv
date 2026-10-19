import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SplitButton } from "./index";

describe("SplitButton", () => {
  it("renders the primary action and a labelled menu trigger with the menu closed", () => {
    const html = renderToStaticMarkup(
      <SplitButton
        onClick={vi.fn()}
        menuLabel="More ways to add a thing"
        items={[{ label: "Import things", onSelect: vi.fn() }]}
      >
        New thing
      </SplitButton>
    );

    expect(html).toContain("New thing");
    expect(html).toContain('aria-label="More ways to add a thing"');
    expect(html).not.toContain("Import things");
  });
});
