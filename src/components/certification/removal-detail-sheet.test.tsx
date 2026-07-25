import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RemovalReviewAction } from "./removal-detail-sheet";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

describe("RemovalReviewAction", () => {
  it("routes an actionable removal through review instead of submitting directly", () => {
    const html = renderToStaticMarkup(
      <RemovalReviewAction
        isActionable
        reviewHref="/certification/removals?resume=removal-1&amp;facility=facility-1"
      />,
    );

    expect(html).toContain("Review &amp; submit");
    expect(html).toContain("<a");
    expect(html).not.toContain("<button");
  });

  it("renders no action for completed removals", () => {
    expect(
      renderToStaticMarkup(
        <RemovalReviewAction isActionable={false} reviewHref="/unused" />,
      ),
    ).toBe("");
  });
});
