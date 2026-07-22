import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SupplierLocationsReadState } from "./supplier-locations-read-state";

describe("SupplierLocationsReadState", () => {
  it("announces the pending locations query", () => {
    const html = renderToStaticMarkup(
      <SupplierLocationsReadState
        isPending
        isError={false}
        isRetrying={false}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Loading supplier locations…");
    expect(html).toContain('aria-busy="true"');
  });

  it("renders a retryable alert and preserves retry progress", () => {
    const html = renderToStaticMarkup(
      <SupplierLocationsReadState
        isPending={false}
        isError
        isRetrying
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Supplier locations unavailable");
    expect(html).toContain("Retry");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });
});
