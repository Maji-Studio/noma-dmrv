import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  RemovalReviewAction,
  RemovalStorageSitesField,
} from "./removal-detail-sheet";

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

describe("RemovalStorageSitesField", () => {
  it.each([
    {
      isProduction: false,
      expectedHost: "https://registry.sandbox.isometric.com",
    },
    {
      isProduction: true,
      expectedHost: "https://registry.isometric.com",
    },
  ])("links to $expectedHost", ({ isProduction, expectedHost }) => {
    const html = renderToStaticMarkup(
      <RemovalStorageSitesField
        externalProjectId="prj_1K9YJ33RKSBX9FFF"
        isProduction={isProduction}
      />,
    );

    expect(html).toContain("Storage sites");
    expect(html).toContain("View on Isometric");
    expect(html).toContain(
      `${expectedHost}/account/certify/project/prj_1K9YJ33RKSBX9FFF/storage-sites?tab=sites`,
    );
  });

  it("renders nothing without a project mapping", () => {
    expect(
      renderToStaticMarkup(
        <RemovalStorageSitesField
          externalProjectId={null}
          isProduction={false}
        />,
      ),
    ).toBe("");
  });
});
