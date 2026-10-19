import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PartyLocationsReadState } from "./party-locations-read-state";

describe.each(["Customer", "Supplier"] as const)("%s locations read state", (partyLabel) => {
  it("announces the pending locations query", () => {
    const html = renderToStaticMarkup(
      <PartyLocationsReadState
        partyLabel={partyLabel}
        isPending
        isError={false}
        isRetrying={false}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain(`Loading ${partyLabel.toLowerCase()} locations…`);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('aria-busy');
  });

  it("renders a retryable warning and preserves retry progress", () => {
    const html = renderToStaticMarkup(
      <PartyLocationsReadState
        partyLabel={partyLabel}
        isPending={false}
        isError
        isRetrying
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain(`${partyLabel} locations unavailable`);
    expect(html).toContain("Retry");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
  });

  it("renders nothing after a successful read", () => {
    expect(renderToStaticMarkup(
      <PartyLocationsReadState
        partyLabel={partyLabel}
        isPending={false}
        isError={false}
        isRetrying={false}
        onRetry={vi.fn()}
      />,
    )).toBe("");
  });
});
