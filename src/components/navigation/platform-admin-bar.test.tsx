import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlatformAdminBar } from "./platform-admin-bar";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

describe("PlatformAdminBar", () => {
  it("is a labelled region naming the organization with a way back", () => {
    const html = renderToStaticMarkup(<PlatformAdminBar organizationName="Mafinga Biochar" />);

    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Platform Admin"');
    expect(html).toContain("Platform Admin in");
    expect(html).toContain("Mafinga Biochar");
    expect(html).toContain('href="/admin/organizations"');
    expect(html).toContain("Back to Platform");
  });
});
