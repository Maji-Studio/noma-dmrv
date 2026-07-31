import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedstockAllocationSummary } from "./feedstock-allocation-summary";

describe("FeedstockAllocationSummary", () => {
  it("shows a concise non-blocking advisory for unallocated wet mass", () => {
    const markup = renderToStaticMarkup(
      <FeedstockAllocationSummary allocatedKg={900} deliveredKg={1000} />,
    );
    const visibleText = markup.replace(/<[^>]+>/g, "");

    expect(visibleText).toContain("900.00 kg of 1000.00 kg allocated");
    expect(visibleText).toContain("100.00 kg not allocated.");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
  });
});
